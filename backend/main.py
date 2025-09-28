# backend/main.py
import os
import io
import base64
import numpy as np
import cv2
from PIL import Image
import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import socketio
from dotenv import load_dotenv

load_dotenv()

HF_TOKEN = os.getenv("HUGGINGFACE_TOKEN")
if not HF_TOKEN:
    print("❌ WARNING: HUGGINGFACE_TOKEN not found in .env!")

MODEL_ID = "dima806/facial_emotions_image_detection"

# Initialize FastAPI
app = FastAPI()

# Add CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Socket.IO Server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*', logger=False, engineio_logger=False)
asgi_app = socketio.ASGIApp(sio, app)

# Load face detector once globally
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')


def decode_image(data_url):
    try:
        if "," not in data_url:
            raise ValueError("Invalid Data URL: missing comma")
        header, encoded = data_url.split(",", 1)
        data = base64.b64decode(encoded)
        img = Image.open(io.BytesIO(data)).convert("RGB")
        return img
    except Exception as e:
        print(f"📷 decode_image failed: {e}")
        return None


def crop_face_pil(image_pil):
    try:
        image_np = np.array(image_pil)
        gray = cv2.cvtColor(image_np, cv2.COLOR_RGB2GRAY)

        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.03,
            minNeighbors=3,
            minSize=(50, 50),
            flags=cv2.CASCADE_SCALE_IMAGE
        )

        if len(faces) == 0:
            gray_eq = cv2.equalizeHist(gray)
            faces = face_cascade.detectMultiScale(
                gray_eq,
                scaleFactor=1.05,
                minNeighbors=3,
                minSize=(40, 40)
            )

        if len(faces) == 0:
            return None

        # Get largest face
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        margin = int(0.3 * w)
        x = max(0, x - margin)
        y = max(0, y - margin)
        w = min(image_np.shape[1] - x, w + 2 * margin)
        h = min(image_np.shape[0] - y, h + 2 * margin)

        crop = image_np[y:y+h, x:x+w]
        return Image.fromarray(crop)
    except Exception as e:
        print(f"⚠️ Face cropping failed: {e}")
        return None

async def predict_emotion(image_pil):
    if not HF_TOKEN:
        print("❌ No Hugging Face token!")
        return {"neutral": 1.0}

    if image_pil is None:
        print("⚠️ predict_emotion: image_pil is None")
        return {"neutral": 1.0}

    try:
        if image_pil.size[0] <= 0 or image_pil.size[1] <= 0:
            print("⚠️ Invalid image size")
            return {"neutral": 1.0}
    except Exception:
        return {"neutral": 1.0}

    # Encode image as base64
    buffer = io.BytesIO()
    try:
        image_pil = image_pil.convert("RGB")
        image_pil.save(buffer, format="JPEG", quality=80)
        buffer.seek(0)
        b64_str = base64.b64encode(buffer.read()).decode("utf-8")
        payload = {"inputs": f"data:image/jpeg;base64,{b64_str}"}
    except Exception as e:
        print(f"🖼️ Encoding failed: {e}")
        return {"neutral": 1.0}

    # ✅ CORRECT URL (NO EXTRA SPACES!)
    api_url = f"https://api-inference.huggingface.co/models/{MODEL_ID.strip()}"
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}

    try:
        response = requests.post(api_url, headers=headers, json=payload, timeout=10)
        print(f"📡 HF Status: {response.status_code}")

        if response.status_code == 200:
            preds = response.json()
            print(f"✅ RAW MODEL OUTPUT: {preds}")  # 🔥 Critical: See what's really coming

            # Map model labels → your app emotions
            emotion_map = {
                "happy": "joy",
                "sad": "sadness",
                "angry": "anger",
                "fear": "surprise",
                "surprise": "surprise",
                "disgust": "anger",
                "neutral": "neutral"
            }

            # Initialize all emotions
            result = {emotion: 0.0 for emotion in ["joy", "surprise", "anger", "sadness", "neutral"]}

            for pred in preds:
                label = pred.get("label", "").lower().strip()
                score = pred.get("score", 0.0)

                mapped = emotion_map.get(label)
                if mapped and mapped in result:
                    result[mapped] += score  # Accumulate anger from angry + disgust

            # Normalize only if sum > 0
            total = sum(result.values())
            if total > 0:
                result = {k: round(v / total, 3) for k, v in result.items()}
            else:
                result = {"joy": 0.0, "surprise": 0.0, "anger": 0.0, "sadness": 0.0, "neutral": 1.0}

            print(f"📊 EMOTION OUTPUT TO FRONTEND: {result}")  # Debug visibility
            return result

        elif response.status_code == 503:
            print("⏳ Model loading... sending neutral")
            return {"neutral": 1.0}

        else:
            print(f"❌ HF Error {response.status_code}: {response.text}")
            return {"neutral": 1.0}

    except Exception as e:
        print(f"💥 Request failed: {e}")
        return {"neutral": 1.0}


@sio.event
async def connect(sid, environ):
    print(f"✅ Client connected: {sid}")


@sio.event
async def disconnect(sid):
    print(f"❌ Client disconnected: {sid}")


@sio.event
async def frame(sid, data):
    try:
        img_data = data.get("img")
        timestamp = data.get("timestamp")

        if not img_data or not timestamp:
            await sio.emit("emotion", {"emotions": {"neutral": 1.0}, "timestamp": timestamp}, to=sid)
            return

        # Decode image
        img_pil = decode_image(img_data)
        if img_pil is None:
            raise ValueError("Failed to decode image")

        # Crop face
        face_crop = crop_face_pil(img_pil)
        input_img = face_crop if face_crop is not None else img_pil

        # Predict
        emotions = await predict_emotion(input_img)

        # Emit result
        await sio.emit("emotion", {"emotions": emotions, "timestamp": timestamp}, to=sid)

    except Exception as e:
        print(f"🔥 Frame processing error: {e}")
        await sio.emit("emotion", {
            "emotions": {"neutral": 1.0},
            "timestamp": data.get("timestamp", 0)
        }, to=sid)


@app.get("/")
async def root():
    return {"message": "NeuroLens Backend Running!"}