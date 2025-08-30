#!/usr/bin/env python3
"""
Setup script for optional image analysis dependencies.
This script installs the Python libraries needed for AI-powered alt text generation.
"""

import subprocess
import sys
import os

def get_python_command():
    """Find the correct Python command to use."""
    import shutil
    
    # Try python3 first (more explicit)
    if shutil.which('python3'):
        return 'python3'
    
    # Fall back to python
    if shutil.which('python'):
        return 'python'
    
    # Use sys.executable as last resort
    return sys.executable

def run_command(command):
    """Run a shell command and return success status."""
    try:
        subprocess.check_call(command, shell=True)
        return True
    except subprocess.CalledProcessError:
        return False

def check_python():
    """Check if Python is available."""
    try:
        version = subprocess.check_output([sys.executable, '--version'], stderr=subprocess.STDOUT)
        print(f"✓ Python found: {version.decode().strip()}")
        return True
    except Exception as e:
        print(f"✗ Python not found: {e}")
        return False

def install_dependencies():
    """Install required Python packages for image analysis."""
    python_cmd = get_python_command()
    
    packages = [
        'torch',
        'transformers',
        'Pillow',
        'numpy'
    ]
    
    print(f"Using Python command: {python_cmd}")
    print("Installing Python packages for image analysis...")
    
    # Try different installation methods
    install_methods = [
        ("--user", "user directory"),
        ("--break-system-packages", "system packages (with override)"),
    ]
    
    for package in packages:
        print(f"Installing {package}...")
        installed = False
        
        for method_flag, method_desc in install_methods:
            try:
                if run_command(f"{python_cmd} -m pip install {method_flag} {package}"):
                    print(f"✓ {package} installed successfully (using {method_desc})")
                    installed = True
                    break
            except:
                continue
        
        if not installed:
            print(f"✗ Failed to install {package} with all methods")
            print(f"\nYou may need to create a virtual environment:")
            print(f"  {python_cmd} -m venv epub-env")
            print(f"  source epub-env/bin/activate  # On macOS/Linux")
            print(f"  {python_cmd} -m pip install {package}")
            return False
    
    return True

def check_optional_tools():
    """Check for optional tools like Tesseract OCR and ExifTool."""
    print("\nChecking optional tools:")
    
    # Check Tesseract OCR
    if run_command("tesseract --version > /dev/null 2>&1"):
        print("✓ Tesseract OCR is available")
    else:
        print("! Tesseract OCR not found. Install it for text extraction from images:")
        if sys.platform == "darwin":  # macOS
            print("  brew install tesseract")
        elif sys.platform == "linux":
            print("  sudo apt-get install tesseract-ocr  # Debian/Ubuntu")
            print("  sudo yum install tesseract          # CentOS/RHEL")
        else:
            print("  See: https://github.com/tesseract-ocr/tesseract")
    
    # Check ExifTool
    if run_command("exiftool -ver > /dev/null 2>&1"):
        print("✓ ExifTool is available")
    else:
        print("! ExifTool not found. Install it for image metadata extraction:")
        if sys.platform == "darwin":  # macOS
            print("  brew install exiftool")
        elif sys.platform == "linux":
            print("  sudo apt-get install libimage-exiftool-perl  # Debian/Ubuntu")
            print("  sudo yum install perl-Image-ExifTool         # CentOS/RHEL")
        else:
            print("  See: https://exiftool.org/")

def main():
    """Main setup function."""
    python_cmd = get_python_command()
    
    print("🖼️  EPUB Accessibility Fixer - Image Analysis Setup")
    print("=" * 50)
    
    if not check_python():
        print("\nPython is required but not found. Please install Python 3.7+ and try again.")
        return False
    
    print(f"\n✓ Using Python: {python_cmd}")
    print("\nThis will install Python packages for AI-powered image analysis.")
    print("This enables automatic generation of meaningful alt text based on image content.")
    print("\nPackages to be installed:")
    print("- torch (PyTorch)")
    print("- transformers (Hugging Face)")
    print("- Pillow (PIL)")
    print("- numpy")
    
    response = input("\nDo you want to proceed? (y/N): ").lower().strip()
    if response not in ['y', 'yes']:
        print("Setup cancelled.")
        return False
    
    if install_dependencies():
        print("\n✓ All Python packages installed successfully!")
        print("\nImage analysis capabilities are now available.")
        print("The alt text fixer will automatically use AI models to generate")
        print("descriptive alt text based on actual image content.")
    else:
        print("\n✗ Some packages failed to install.")
        print("\nFor externally managed Python environments (like Homebrew), try:")
        print("\n1. Using pipx (recommended):")
        print("   brew install pipx")
        print("   pipx install torch transformers Pillow numpy")
        print("\n2. Using virtual environment:")
        print(f"   {python_cmd} -m venv epub-env")
        print("   source epub-env/bin/activate")
        print(f"   {python_cmd} -m pip install torch transformers Pillow numpy")
        print("\n3. Force install to user directory:")
        print(f"   {python_cmd} -m pip install --user torch transformers Pillow numpy")
        return False
    
    check_optional_tools()
    
    print("\n🎉 Setup complete!")
    print("\nUsage:")
    print("The image analysis will be used automatically when fixing alt text.")
    print("No additional configuration is required.")
    
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)