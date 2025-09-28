# backend/main.py
import os
import io
import base64
import numpy as np
from PIL import Image
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import socketio
import torch
from transformers import ViTFeatureExtractor, ViTForImageClassification
import mediapipe as mp
from datetime import datetime, timedelta
import json
import asyncio
from typing import Dict, List, Optional

# ----------------------------
# CONFIGURATION
# ----------------------------
MODEL_ID = "dima806/facial_emotions_image_detection"

# Emotion mapping: model output → your app labels
EMOTION_MAP = {
    "happy": "joy",
    "surprise": "surprise",
    "angry": "anger",
    "sad": "sadness",
    "fear": "surprise",      # map fear → surprise
    "disgust": "anger",      # map disgust → anger
    "neutral": "neutral"
}

# Final emotion labels (NO 'boredom' — model doesn't predict it!)
APP_EMOTIONS = ["joy", "surprise", "anger", "sadness", "neutral"]

# ----------------------------
# GLOBAL INITIALIZATION
# ----------------------------
# Load ViT model and feature extractor ONCE at startup
print("Loading ViT emotion model...")
feature_extractor = ViTFeatureExtractor.from_pretrained(MODEL_ID)
model = ViTForImageClassification.from_pretrained(MODEL_ID)
model.eval()  # Set to evaluation mode
print("✅ ViT model loaded!")

# Initialize MediaPipe Face Detection
mp_face_detection = mp.solutions.face_detection
face_detector = mp_face_detection.FaceDetection(
    model_selection=1,  # 0: <2m, 1: <5m
    min_detection_confidence=0.5
)
print("✅ MediaPipe face detector ready!")

# Global session storage
video_sessions: Dict[str, Dict] = {}
server_start_time = datetime.now()

# ----------------------------
# FASTAPI + SOCKET.IO SETUP
# ----------------------------
app = FastAPI()

# Enhanced CORS middleware for browser extension support
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*",  # For development
        "https://www.youtube.com",
        "https://youtube.com",
        "chrome-extension://*",  # For Chrome extension
        "moz-extension://*",     # For Firefox extension
        "http://localhost:3000", # Your React frontend
        "http://localhost:8000"  # Backend self-reference
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
asgi_app = socketio.ASGIApp(sio, app)

# ----------------------------
# UTILITY FUNCTIONS
# ----------------------------
def decode_image(data_url: str) -> Image.Image | None:
    try:
        if "," not in data_url:
            raise ValueError("Invalid Data URL")
        _, encoded = data_url.split(",", 1)
        data = base64.b64decode(encoded)
        img = Image.open(io.BytesIO(data)).convert("RGB")
        return img
    except Exception as e:
        print(f"decode_image failed: {e}")
        return None


def crop_face_mediapipe(image_pil: Image.Image) -> Image.Image | None:
    try:
        image_np = np.array(image_pil)
        h, w = image_np.shape[:2]
        results = face_detector.process(image_np)
        
        if not results.detections:
            return None

        # Use the largest (most confident) face
        detection = max(results.detections, key=lambda d: d.score[0])
        bbox = detection.location_data.relative_bounding_box
        
        x = int(bbox.xmin * w)
        y = int(bbox.ymin * h)
        width = int(bbox.width * w)
        height = int(bbox.height * h)
        
        # Add 50% margin for better context
        margin_x = int(0.5 * width)
        margin_y = int(0.5 * height)
        
        x1 = max(0, x - margin_x)
        y1 = max(0, y - margin_y)
        x2 = min(w, x + width + margin_x)
        y2 = min(h, y + height + margin_y)
        
        crop = image_np[y1:y2, x1:x2]
        return Image.fromarray(crop)
    
    except Exception as e:
        print(f"MediaPipe cropping failed: {e}")
        return None


def predict_emotion_local(image_pil: Image.Image) -> dict:
    try:
        if image_pil is None:
            return {e: 0.0 for e in APP_EMOTIONS}
        
        # Ensure minimum size (ViT expects ~224x224)
        if min(image_pil.size) < 64:
            return {e: 0.0 for e in APP_EMOTIONS}

        # Preprocess
        inputs = feature_extractor(images=image_pil, return_tensors="pt")
        
        # Inference
        with torch.no_grad():
            outputs = model(**inputs)
            logits = outputs.logits
        
        # Softmax to probabilities
        probs = torch.softmax(logits, dim=1).squeeze().cpu().numpy()
        
        # Map to your emotion labels
        result = {e: 0.0 for e in APP_EMOTIONS}
        for i, prob in enumerate(probs):
            label = model.config.id2label[i].lower()
            mapped = EMOTION_MAP.get(label, "neutral")
            if mapped in result:
                result[mapped] = max(result[mapped], float(prob))  # take highest

        # Normalize (in case of mapping overlaps)
        total = sum(result.values())
        if total > 0:
            result = {k: v / total for k, v in result.items()}
        else:
            result["neutral"] = 1.0

        return result

    except Exception as e:
        print(f"Local prediction error: {e}")
        return {"joy": 0.0, "surprise": 0.0, "anger": 0.0, "sadness": 0.0, "neutral": 1.0}


# ----------------------------
# SESSION MANAGEMENT
# ----------------------------
def create_session_key(sid: str, video_url: str = "") -> str:
    """Create a unique session key"""
    return f"{sid}_{hash(video_url)}_{int(datetime.now().timestamp())}"


def clean_old_sessions():
    """Remove sessions older than 1 hour"""
    current_time = datetime.now()
    sessions_to_remove = []
    
    for session_key, session_data in video_sessions.items():
        if current_time - session_data["start_time"] > timedelta(hours=1):
            sessions_to_remove.append(session_key)
    
    for session_key in sessions_to_remove:
        del video_sessions[session_key]
        print(f"Cleaned up old session: {session_key}")


async def periodic_cleanup():
    """Background task to clean up old sessions"""
    while True:
        await asyncio.sleep(3600)  # Run every hour
        clean_old_sessions()


# ----------------------------
# SOCKET.IO EVENTS
# ----------------------------
@sio.event
async def connect(sid, environ):
    print(f"✅ Client connected: {sid}")


@sio.event
async def disconnect(sid):
    print(f"❌ Client disconnected: {sid}")
    
    # Clean up session data for this client
    sessions_to_remove = [key for key in video_sessions.keys() if key.startswith(f"{sid}_")]
    for session_key in sessions_to_remove:
        print(f"Removing session: {session_key}")
        del video_sessions[session_key]


@sio.event
async def frame(sid, data):
    try:
        img_data = data.get("img")
        timestamp = data.get("timestamp")
        video_time = data.get("videoTime", 0)
        video_url = data.get("videoUrl", "")
        
        if not img_data or not timestamp:
            await sio.emit("emotion", {
                "emotions": {"neutral": 1.0}, 
                "timestamp": timestamp,
                "videoTime": video_time,
                "confidence": 0.0,
                "face_detected": False
            }, to=sid)
            return

        # Decode image
        img_pil = decode_image(img_data)
        if img_pil is None:
            raise ValueError("Failed to decode image")

        # Crop face with MediaPipe
        face_crop = crop_face_mediapipe(img_pil)
        input_img = face_crop if face_crop is not None else img_pil

        # Predict locally
        emotions = predict_emotion_local(input_img)
        
        # Calculate confidence score based on max emotion value
        max_emotion_value = max(emotions.values())
        confidence = min(max_emotion_value * 1.2, 1.0)  # Boost confidence slightly, cap at 1.0

        # Create or update session
        session_key = create_session_key(sid, video_url)
        
        # Find existing session for this client and video
        existing_session = None
        for key, session in video_sessions.items():
            if key.startswith(f"{sid}_") and session.get("video_url") == video_url:
                existing_session = key
                break
        
        if existing_session:
            session_key = existing_session
        else:
            video_sessions[session_key] = {
                "start_time": datetime.now(),
                "video_url": video_url,
                "emotion_history": [],
                "client_id": sid
            }
        
        # Add to session history
        emotion_entry = {
            "timestamp": timestamp,
            "video_time": video_time,
            "emotions": emotions,
            "confidence": confidence,
            "face_detected": face_crop is not None
        }
        
        video_sessions[session_key]["emotion_history"].append(emotion_entry)
        
        # Keep only last 500 entries per session (memory management)
        if len(video_sessions[session_key]["emotion_history"]) > 500:
            video_sessions[session_key]["emotion_history"] = video_sessions[session_key]["emotion_history"][-500:]

        # Emit enhanced result
        await sio.emit("emotion", {
            "emotions": emotions, 
            "timestamp": timestamp,
            "videoTime": video_time,
            "confidence": confidence,
            "face_detected": face_crop is not None,
            "session_id": session_key
        }, to=sid)

    except Exception as e:
        print(f"Frame processing error: {e}")
        await sio.emit("emotion", {
            "emotions": {"neutral": 1.0},
            "timestamp": data.get("timestamp", 0),
            "videoTime": data.get("videoTime", 0),
            "confidence": 0.0,
            "face_detected": False,
            "error": str(e)
        }, to=sid)


# ----------------------------
# REST API ENDPOINTS
# ----------------------------
@app.get("/")
async def root():
    return {
        "message": "NeuroLens Backend Running!", 
        "model": MODEL_ID, 
        "local_inference": True,
        "version": "1.0.0",
        "browser_extension_ready": True
    }


@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring"""
    active_connections = len(sio.manager.rooms.get("/", {}))
    uptime = (datetime.now() - server_start_time).total_seconds()
    
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "active_connections": active_connections,
        "active_sessions": len(video_sessions),
        "model_loaded": True,
        "uptime_seconds": uptime,
        "version": "1.0.0"
    }


@app.get("/status")
async def get_status():
    """Detailed status information"""
    return {
        "model": MODEL_ID,
        "emotions": APP_EMOTIONS,
        "emotion_mapping": EMOTION_MAP,
        "local_inference": True,
        "active_sessions": len(video_sessions),
        "server_start_time": server_start_time.isoformat(),
        "uptime_minutes": (datetime.now() - server_start_time).total_seconds() / 60,
        "face_detection_enabled": True,
        "browser_extension_support": True
    }


@app.get("/sessions")
async def list_sessions():
    """List all active sessions"""
    sessions_info = []
    for session_key, session_data in video_sessions.items():
        sessions_info.append({
            "session_id": session_key,
            "start_time": session_data["start_time"].isoformat(),
            "video_url": session_data.get("video_url", "Unknown"),
            "data_points": len(session_data["emotion_history"]),
            "duration_minutes": (datetime.now() - session_data["start_time"]).total_seconds() / 60
        })
    
    return {
        "total_sessions": len(video_sessions),
        "sessions": sessions_info
    }


@app.get("/session/{session_id}")
async def get_session_data(session_id: str):
    """Get emotion data for a specific session"""
    session_data = video_sessions.get(session_id)
    if not session_data:
        return {"error": "Session not found", "session_id": session_id}
    
    # Calculate analytics
    emotion_history = session_data["emotion_history"]
    analytics = {}
    
    if emotion_history:
        # Calculate average emotions
        avg_emotions = {emotion: 0.0 for emotion in APP_EMOTIONS}
        for entry in emotion_history:
            for emotion, value in entry["emotions"].items():
                avg_emotions[emotion] += value
        
        for emotion in avg_emotions:
            avg_emotions[emotion] /= len(emotion_history)
        
        # Find emotion peaks (confidence > 0.8)
        peaks = []
        for entry in emotion_history:
            if entry["confidence"] > 0.8:
                dominant_emotion = max(entry["emotions"], key=entry["emotions"].get)
                peaks.append({
                    "emotion": dominant_emotion,
                    "confidence": entry["confidence"],
                    "video_time": entry["video_time"],
                    "timestamp": entry["timestamp"]
                })
        
        analytics = {
            "average_emotions": avg_emotions,
            "emotion_peaks": peaks,
            "total_peaks": len(peaks),
            "average_confidence": sum(entry["confidence"] for entry in emotion_history) / len(emotion_history)
        }
    
    return {
        "session_id": session_id,
        "start_time": session_data["start_time"].isoformat(),
        "video_url": session_data.get("video_url", ""),
        "data_points": len(emotion_history),
        "duration_minutes": (datetime.now() - session_data["start_time"]).total_seconds() / 60,
        "emotion_history": emotion_history,
        "analytics": analytics
    }


@app.delete("/session/{session_id}")
async def delete_session(session_id: str):
    """Delete a specific session"""
    if session_id in video_sessions:
        del video_sessions[session_id]
        return {"message": f"Session {session_id} deleted successfully"}
    else:
        return {"error": "Session not found", "session_id": session_id}


@app.delete("/sessions/cleanup")
async def cleanup_sessions():
    """Manually trigger cleanup of old sessions"""
    sessions_before = len(video_sessions)
    clean_old_sessions()
    sessions_after = len(video_sessions)
    
    return {
        "message": "Cleanup completed",
        "sessions_removed": sessions_before - sessions_after,
        "remaining_sessions": sessions_after
    }


@app.get("/analytics/summary")
async def get_analytics_summary():
    """Get summary analytics across all sessions"""
    if not video_sessions:
        return {"message": "No active sessions"}
    
    total_data_points = 0
    all_emotions = {emotion: [] for emotion in APP_EMOTIONS}
    all_confidences = []
    
    for session_data in video_sessions.values():
        for entry in session_data["emotion_history"]:
            total_data_points += 1
            all_confidences.append(entry["confidence"])
            
            for emotion, value in entry["emotions"].items():
                if emotion in all_emotions:
                    all_emotions[emotion].append(value)
    
    # Calculate overall averages
    avg_emotions = {}
    for emotion, values in all_emotions.items():
        avg_emotions[emotion] = sum(values) / len(values) if values else 0.0
    
    return {
        "total_sessions": len(video_sessions),
        "total_data_points": total_data_points,
        "average_confidence": sum(all_confidences) / len(all_confidences) if all_confidences else 0.0,
        "average_emotions_across_sessions": avg_emotions,
        "most_common_emotion": max(avg_emotions, key=avg_emotions.get) if avg_emotions else "neutral"
    }


# Handle CORS preflight requests for browser extensions
@app.options("/{path:path}")
async def options_handler(path: str):
    """Handle CORS preflight requests"""
    return {"message": "OK"}


# ----------------------------
# STARTUP & CLEANUP
# ----------------------------
@app.on_event("startup")
async def startup_event():
    """Initialize server and start background tasks"""
    print("🔥 Warming up model...")
    dummy = Image.new('RGB', (224, 224), (128, 128, 128))
    _ = predict_emotion_local(dummy)
    print("✅ Model warm-up complete!")
    
    # Start background cleanup task
    asyncio.create_task(periodic_cleanup())
    print("🧹 Session cleanup task started")
    
    print("🚀 NeuroLens backend ready for browser extension!")
    print(f"📍 Server running at: http://localhost:8000")
    print(f"🧠 Model: {MODEL_ID}")
    print(f"😊 Emotions: {', '.join(APP_EMOTIONS)}")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up resources on shutdown"""
    print("🛑 Shutting down NeuroLens backend...")
    
    # Clean up all sessions
    video_sessions.clear()
    
    # Close MediaPipe resources
    face_detector.close()
    
    print("✅ Shutdown complete")


# ----------------------------
# MAIN ENTRY POINT
# ----------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:asgi_app",
        host="localhost",
        port=8000,
        reload=True,
        log_level="info"
    )