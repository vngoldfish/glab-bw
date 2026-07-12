import subprocess
import sys
import os
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"

def main():
    print("=== 1. Bien dich Frontend ===")
    try:
        subprocess.run("npm run build", shell=True, cwd=str(FRONTEND), check=True)
    except subprocess.CalledProcessError as e:
        print(f"Loi khi build frontend: {e}")
        sys.exit(1)

    print("\n=== 2. Dong goi ung dung voi PyInstaller ===")
    
    # Don dep build & dist cu
    for p in [ROOT / "build", ROOT / "dist"]:
        if p.exists():
            try:
                shutil.rmtree(p)
            except Exception as e:
                print(f"Canh bao: Khong the xoa {p}: {e}")

    # Build command using python -m PyInstaller for stability
    pyinstaller_cmd = [
        sys.executable,
        "-m", "PyInstaller",
        "--onefile",
        "--name=BawuiApp",
        f"--add-data=frontend/dist{os.pathsep}frontend/dist",
        f"--paths=backend",
        "--clean",
        str(BACKEND / "run_app.py")
    ]

    print(f"Chay lenh: {' '.join(pyinstaller_cmd)}")
    try:
        subprocess.run(pyinstaller_cmd, cwd=str(ROOT), check=True)
    except subprocess.CalledProcessError as e:
        print(f"Loi khi dong goi PyInstaller: {e}")
        sys.exit(1)

    print("\n========================================")
    print("  DONG GOI THANH CONG!")
    print(f"  File chay single-click: {ROOT / 'dist' / 'BawuiApp.exe'}")
    print("========================================")

if __name__ == "__main__":
    main()
