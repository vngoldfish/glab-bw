import uvicorn
import webbrowser
import sys
from pathlib import Path

# Ensure backend directory is in python path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.main import app

if __name__ == "__main__":
    print("----------------------------------------")
    print("  Bawui APP 1 - Dang khoi dong...")
    print("  Giao dien: http://127.0.0.1:8765/")
    print("----------------------------------------")
    
    # Open browser automatically
    webbrowser.open("http://127.0.0.1:8765/")
    
    # Start uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
