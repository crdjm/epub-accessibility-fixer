# Image Content Analysis for Alt Text Generation

This enhanced version of the EPUB Accessibility Fixer includes advanced image content analysis capabilities to generate meaningful alt text based on what's actually in the images.

## Features

### 🤖 AI-Powered Image Analysis
- Uses state-of-the-art computer vision models (BLIP) to analyze image content
- Generates descriptive alt text based on visual elements, objects, and scenes
- Combines AI analysis with contextual information from surrounding HTML

### 📝 OCR Text Extraction  
- Extracts text from images using Tesseract OCR
- Perfect for images containing charts, diagrams, or text content
- Automatically generates alt text describing the extracted text

### 📊 Metadata Analysis
- Reads image metadata (EXIF data) for title and description information
- Uses existing image titles and keywords when available
- Leverages photographer/creator annotations

### 🎯 Contextual Enhancement
- Combines AI analysis with surrounding HTML context
- Uses figure captions, nearby headings, and paragraph text
- Provides comprehensive, contextually relevant alt text

## Installation

### Basic Installation
The image analysis features are optional. The tool will work without them, falling back to filename and context-based alt text generation.

### Full Installation with AI Capabilities

1. **Install Python Dependencies**
   ```bash
   python setup-image-analysis.py
   ```

2. **Install Optional Tools** (recommended)
   
   **macOS:**
   ```bash
   brew install tesseract exiftool
   ```
   
   **Ubuntu/Debian:**
   ```bash
   sudo apt-get install tesseract-ocr libimage-exiftool-perl
   ```
   
   **CentOS/RHEL:**
   ```bash
   sudo yum install tesseract perl-Image-ExifTool
   ```

## How It Works

### Analysis Pipeline
The alt text fixer uses a multi-tier analysis approach:

1. **AI Image Captioning** (highest priority, confidence > 0.7)
   - Uses BLIP (Bootstrapped Language-Image Pre-training) model
   - Generates natural language descriptions of image content
   - Example: "A person reading a book in a library"

2. **OCR Text Extraction** (confidence 0.8)
   - Extracts readable text from images
   - Example: "Image containing text: 'Chapter 5: Data Analysis'"

3. **Metadata Analysis** (confidence 0.5-0.6)
   - Uses existing image metadata when available
   - Example: "Portrait photography of author"

4. **Contextual Analysis** (fallback)
   - Uses surrounding HTML content
   - Example: "Image for section: Introduction to Machine Learning"

5. **Filename Analysis** (final fallback)
   - Generates meaningful text from filenames
   - Example: "Book cover" (from "cover-image.jpg")

### Confidence Scoring
- **High confidence (>0.7)**: AI-generated descriptions used directly
- **Medium confidence (0.3-0.7)**: Combined with contextual information
- **Low confidence (<0.3)**: Marked as "(auto-generated)" for review

## Configuration

The image analysis runs automatically when fixing alt text. No additional configuration is needed.

### Environment Variables
You can control the behavior with these optional environment variables:

```bash
# Disable AI analysis (use only OCR and metadata)
export EPUB_DISABLE_AI_ANALYSIS=true

# Set analysis timeout (default: 30 seconds)
export EPUB_ANALYSIS_TIMEOUT=60

# Enable verbose analysis logging
export EPUB_VERBOSE_ANALYSIS=true
```

## Examples

### Before Enhancement
```html
<img src="chart-sales-2023.png" />
```

### After AI Analysis
```html
<img src="chart-sales-2023.png" alt="Bar chart showing sales data with increasing trend from January to December 2023" />
```

### Before Enhancement
```html
<img src="author-photo.jpg" />
```

### After AI + Context Analysis  
```html
<img src="author-photo.jpg" alt="Professional headshot of a smiling woman in business attire. Context: About the Author section" />
```

## Performance

- **Local AI Analysis**: 2-5 seconds per image
- **OCR Analysis**: 1-3 seconds per image  
- **Metadata Analysis**: <1 second per image
- **Total Processing**: Varies by image count and analysis methods available

The system processes images sequentially to avoid overwhelming system resources.

## Privacy and Security

- **No Cloud Services**: All analysis runs locally by default
- **No Data Transmission**: Images are processed on your machine
- **Optional Cloud APIs**: Future versions may support cloud services (opt-in only)

## Troubleshooting

### Common Issues

**"Python AI dependencies not available"**
- Run `python setup-image-analysis.py` to install required packages
- Ensure Python 3.7+ is installed

**"Tesseract OCR not available"**
- Install Tesseract OCR for text extraction features
- OCR analysis will be skipped if not available

**"Image file not found"**
- Ensure images are accessible in the EPUB structure
- Check that image paths in HTML are correct

### Debug Mode
Enable detailed logging:
```bash
export EPUB_VERBOSE_ANALYSIS=true
epub-fix your-book.epub --fix-alt-text
```

## Contributing

The image analysis system is designed to be extensible. You can add new analysis methods by:

1. Implementing the `ImageAnalysisResult` interface
2. Adding your method to the analysis pipeline in `tryXXXAnalysis()`
3. Following the confidence scoring conventions

## Limitations

- **Model Size**: AI models require ~1-2GB disk space and significant RAM
- **Processing Time**: AI analysis adds processing time per image
- **Language**: Current models work best with English descriptions
- **Accuracy**: AI-generated descriptions should be reviewed for accuracy

## Future Enhancements

- Support for multiple languages in descriptions
- Integration with cloud AI services (Google Vision, Azure, etc.)  
- Batch processing optimization
- Custom model fine-tuning for specific domains
- Interactive review and editing of generated alt text