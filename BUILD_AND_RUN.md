# How to Build and Run the EPUB Accessibility Fixer

## ✅ Build Status: SUCCESS

The EPUB Accessibility Fixer CLI tool has been successfully built and is ready to use!

## 🔨 Building the Project

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the TypeScript Code
```bash
npm run build
```

### 3. Install CLI Globally (Optional)
```bash
npm link
```

After running `npm link`, you can use `epub-fix` command from anywhere on your system.

## 🚀 Running the CLI

### Command Format
```bash
epub-fix [options] <input.epub>
```

### Basic Usage Examples

#### 1. Analyze an EPUB (no fixes applied)
```bash
epub-fix book.epub --analyze-only
```

#### 2. Analyze and Fix an EPUB
```bash
epub-fix book.epub
```
This will:
- Create `book_fixed.epub` (the fixed EPUB)
- Create `book_report.html` (detailed analysis report)

#### 3. Custom Output Locations
```bash
epub-fix input.epub --output fixed_book.epub --report analysis_report.html
```

#### 4. Dry Run (see what would be fixed)
```bash
epub-fix book.epub --dry-run
```

#### 5. Verbose Output for Debugging
```bash
epub-fix book.epub --verbose
```

#### 6. Skip Certain Checks
```bash
# Only run accessibility analysis (skip validation)
epub-fix book.epub --skip-validation

# Only run validation (skip accessibility)
epub-fix book.epub --skip-accessibility
```

### Advanced Commands

#### Install External Tools
```bash
epub-fix install-tools
```

#### Validate EPUB Only
```bash
epub-fix validate book.epub
```

#### Show Current Configuration
```bash
epub-fix config
```

## 📁 What Gets Created

When you run the fixer, you'll get:

1. **Fixed EPUB** (`*_fixed.epub`): Your original EPUB with accessibility and validation issues fixed
2. **HTML Report** (`*_report.html`): Beautiful, detailed report showing:
   - Summary of issues found and fixed
   - Accessibility score (0-100)
   - Validation score (0-100)
   - Detailed breakdown by priority
   - WCAG compliance information
   - Recommendations for manual fixes

## 🛠️ Development Mode

For development and testing:

```bash
# Run in development mode
npm run dev book.epub

# Run tests (when implemented)
npm test

# Lint the code
npm run lint
```

## 🔧 Configuration

Create a `config.json` file to customize the fixer behavior:

```json
{
  "enabledFixers": [
    "missing-alt-text",
    "heading-structure", 
    "language-attributes"
  ],
  "accessibility": {
    "addMissingAltText": true,
    "fixHeadingStructure": true,
    "addLanguageAttributes": true
  },
  "validation": {
    "fixMissingMetadata": true,
    "fixBrokenLinks": true
  }
}
```

Then use it:
```bash
epub-fix book.epub --config config.json
```

## 🚨 System Requirements

- **Node.js 16+** (required)
- **Java 8+** (required for EpubCheck)
- **macOS/Linux/Windows** (cross-platform)

The CLI will automatically download and install:
- EpubCheck (official EPUB validator)
- DAISY ACE (accessibility checker)

## 📊 What Gets Fixed Automatically

### Accessibility Issues
- ✅ **Missing Alt Text**: Intelligent alt text generation for images
- ✅ **Heading Structure**: Fixes heading hierarchy (h1→h2→h3)
- ✅ **Language Attributes**: Adds missing `lang` attributes
- ✅ **Table Headers**: Ensures proper table accessibility
- ✅ **Navigation Landmarks**: Adds ARIA landmarks

### Validation Issues  
- ✅ **Missing Metadata**: Adds required EPUB metadata
- ✅ **Broken Links**: Fixes internal link references
- ✅ **Invalid XHTML**: Corrects HTML structure issues

## 🎯 Example Output

```bash
$ epub-fix sample.epub

✓ Installing required tools...
✓ Processing EPUB...

Analysis Results:
Total issues found: 15
Critical issues: 2
Fixable issues: 12
Fixed issues: 10
Validation score: 85/100
Accessibility score: 78/100

Critical Issues:
  • Missing alt text for 3 images (missing-alt-text)
  • Invalid heading structure (heading-structure)

✅ Fixed EPUB saved: sample_fixed.epub
   Size: 2.1 MB

📊 HTML Report: sample_report.html

💡 Recommendation:
Critical issues detected. Please review the HTML report for details.
```

## 🐛 Troubleshooting

### Java Not Found
```bash
# Install Java (macOS with Homebrew)
brew install openjdk@11

# Install Java (Ubuntu/Debian)
sudo apt install openjdk-11-jdk
```

### Permission Issues
```bash
# Fix permissions (Unix systems)
chmod +x node_modules/.bin/epub-fix
```

### Tool Installation Issues
```bash
# Manually install tools with verbose output
epub-fix install-tools --verbose
```

## 🎉 You're Ready!

The EPUB Accessibility Fixer is now built and ready to use. Start by analyzing your first EPUB:

```bash
epub-fix your-book.epub --analyze-only --verbose
```

This will give you a detailed report of what issues exist and what can be automatically fixed!