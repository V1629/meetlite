"""
test_openai_key.py – Quick test to verify your OpenAI API key is valid.

Usage:
    python test_openai_key.py
"""

import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

api_key = os.getenv("OPENAI_API_KEY", "")

if not api_key:
    print("❌ OPENAI_API_KEY is not set in .env")
    exit(1)

print(f"🔑 Key found: {api_key[:8]}...{api_key[-4:]}")
print("⏳ Testing API connection...")

try:
    client = OpenAI(api_key=api_key)
    models = client.models.list()
    print("✅ API key is valid! Connection successful.")
    print(f"   Available models: {len(models.data)}")

    # Check if whisper-1 is available
    whisper = [m for m in models.data if "whisper" in m.id]
    if whisper:
        print(f"   🎙️  Whisper model available: {whisper[0].id}")
    else:
        print("   ⚠️  Whisper model not found in available models")

except Exception as e:
    print(f"❌ API key is INVALID or revoked!")
    print(f"   Error: {e}")
    print("\n👉 Generate a new key at: https://platform.openai.com/api-keys")
