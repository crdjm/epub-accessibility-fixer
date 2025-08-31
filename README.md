# EPUB Accessibility Fixer

A comprehensive CLI tool for analyzing and automatically fixing EPUB validation and accessibility issues using industry-standard tools like EpubCheck and DAISY ACE.

## Features

- **Comprehensive Analysis**: Uses EpubCheck for validation and DAISY ACE for accessibility analysis
- **Automatic Fixes**: Intelligently fixes issues like missing alt text, heading structure problems, language attributes, and more
- **AI-Powered Alt Text**: Generates meaningful alt text using local AI vision models, OCR, and metadata analysis
- **AI Review Interface**: Dedicated review page for all AI-generated alt text with visual verification
- **Detailed Reporting**: Generates beautiful HTML reports with actionable insights
- **Priority-based Processing**: Categorizes and prioritizes issues for optimal fixing order
- **Configurable**: Customizable fix behavior and reporting options
- **Programmatic API**: Can be used as a library in other Node.js applications

## Installation

### Prerequisites

- Node.js 16+ 
- Java 8+ (required for EpubCheck)

### Global Installation

```bash
npm install -g epub-accessibility-fixer
```

### Local Installation

```bash
npm install epub-accessibility-fixer
```

## Quick Start

### Analyze an EPUB

```bash
epub-fix book.epub --analyze-only
```

### Fix an EPUB

```bash
epub-fix book.epub --output book_fixed.epub
```

### Generate Report Only

```bash
epub-fix book.epub --analyze-only --report book_report.html
```

## CLI Usage

### Basic Commands

```bash
# Analyze and fix EPUB with default settings
epub-fix input.epub

# Analyze only (no fixes applied)
epub-fix input.epub --analyze-only

# Specify output file and report location
epub-fix input.epub --output fixed.epub --report report.html

# Dry run (show what would be fixed)
epub-fix input.epub --dry-run

# Keep DAISY ACE and EpubCheck output files
epub-fix input.epub --keep-output

# Verbose output for debugging
epub-fix input.epub --verbose
```

### Advanced Options

```bash
# Skip specific analysis phases
epub-fix input.epub --skip-validation    # Skip EpubCheck validation
epub-fix input.epub --skip-accessibility # Skip DAISY ACE analysis

# Preserve validation output files for manual review
epub-fix input.epub --keep-output

# Use custom configuration
epub-fix input.epub --config custom-config.json
```

### Output File Preservation

When using `--keep-output`, the tool will preserve the raw output files from DAISY ACE and EpubCheck:

- **DAISY ACE Report**: Saved as `{filename}_ace_report_{timestamp}/` directory containing detailed JSON and HTML reports
- **EpubCheck Output**: Saved as `{filename}_epubcheck_{timestamp}.json` containing detailed validation results

These files provide additional technical details beyond the main HTML report and can be useful for:
- Manual review of specific accessibility issues
- Integration with other tools
- Detailed debugging of validation problems
- Custom reporting or analysis workflows

### Advanced Options

```bash
# Skip validation checks (only run accessibility analysis)
epub-fix input.epub --skip-validation

# Skip accessibility analysis (only run validation)
epub-fix input.epub --skip-accessibility

# Use custom configuration
epub-fix input.epub --config ./my-config.json

# Install or update external tools
epub-fix install-tools

# Validate EPUB only (no accessibility analysis)
epub-fix validate input.epub

# Show current configuration
epub-fix config
```

## Configuration

Create a configuration file to customize the fixing behavior:

```json
{
  "enabledFixers": [
    "missing-alt-text",
    "heading-structure", 
    "language-attributes",
    "missing-metadata"
  ],
  "accessibility": {
    "addMissingAltText": true,
    "fixHeadingStructure": true,
    "addLandmarks": true,
    "addLanguageAttributes": true,
    "fixTableHeaders": true,
    "addSkipLinks": true,
    "improveColorContrast": false
  },
  "validation": {
    "fixMissingMetadata": true,
    "fixBrokenLinks": true,
    "fixInvalidXhtml": true
  }
}
```

## Programmatic API

## AI Image Review Feature

When the tool uses AI to generate alt text for images, it automatically creates an **AI Image Review page** alongside the main report. This feature provides:

### Visual Review Interface
- **Side-by-side display**: View images alongside their AI-generated alt text
- **Quality indicators**: Confidence scores and analysis method badges
- **Review controls**: Approve, revise, or reject generated alt text
- **Batch processing**: Review all AI-generated alt text in one place

### Analysis Tracking
- **Method transparency**: Shows whether alt text came from AI vision, OCR, or metadata
- **Model information**: Displays which AI model was used (e.g., LLaVA, Moondream)
- **Confidence scoring**: Visual indicators of analysis reliability
- **Audit trail**: Complete record of AI-generated accessibility content

### Review Workflow
1. **Automatic Generation**: AI image review page created when AI alt text is generated
2. **Main Report Link**: Prominent link from main HTML report to review page
3. **Interactive Review**: Click Approve/Revise/Reject for each image
4. **Revision Tools**: Built-in editor for improving alt text
5. **Persistent Storage**: Review decisions saved in browser for reference

See [AI-IMAGE-REVIEW.md](./AI-IMAGE-REVIEW.md) for detailed documentation.

## Programmatic API

### Basic Usage

```javascript
import { analyzeEpub, fixEpub, validateEpub } from 'epub-accessibility-fixer';

// Analyze an EPUB
const analysisResult = await analyzeEpub('book.epub', true);
console.log(`Found ${analysisResult.summary.totalIssues} issues`);

// Fix an EPUB
const fixResult = await fixEpub('book.epub', 'book_fixed.epub', 'report.html');
console.log(`Fixed ${fixResult.summary.fixedIssues} issues`);

// Validate only
const validationResult = await validateEpub('book.epub');
console.log(`Valid: ${validationResult.valid}`);
```

### Advanced Usage

```javascript
import { EpubAccessibilityProcessor, Logger, loadConfig } from 'epub-accessibility-fixer';

const logger = new Logger(true); // verbose logging
const processor = new EpubAccessibilityProcessor(logger);
const config = loadConfig('./my-config.json');

// Initialize tools
await processor.initializeTools();

// Process with custom options
const options = {
  input: 'book.epub',
  output: 'fixed.epub',
  reportPath: 'report.html',
  analyze: false,
  verbose: true
};

const result = await processor.processEpub(options, config);
```

## Supported Fixes

### Accessibility Fixes

- **Missing Alt Text**: Automatically adds meaningful alt text to images
- **Heading Structure**: Fixes heading hierarchy issues (h1, h2, h3, etc.)
- **Language Attributes**: Adds missing `lang` attributes to HTML elements
- **Table Headers**: Ensures tables have proper header associations
- **Skip Links**: Adds navigation skip links for screen readers
- **Landmarks**: Adds ARIA landmarks for better navigation

### Validation Fixes

- **Missing Metadata**: Adds required EPUB metadata
- **Broken Links**: Fixes internal link references
- **Invalid XHTML**: Corrects HTML structure issues
- **Media Type Issues**: Fixes incorrect MIME types

## Issue Categories

Issues are categorized by priority:

- **Critical**: Prevents EPUB from functioning properly
- **High**: Significantly impacts usability or accessibility
- **Medium**: Important but not critical issues
- **Low**: Minor issues and suggestions

## Reports

The tool generates comprehensive HTML reports that include:

- Executive summary with scores
- Detailed issue breakdown by priority
- WCAG compliance information
- Applied fixes and their results
- Actionable recommendations
- EPUB metadata analysis

## External Tools

The CLI automatically installs and manages:

- **EpubCheck**: Official EPUB validation tool from W3C
- **DAISY ACE**: Accessibility checker from the DAISY Consortium

These tools are downloaded and cached locally to ensure consistent behavior across environments.

## Supported EPUB Versions

**For Validation and Fixing:**
- EPUB 3.0
- EPUB 3.1
- EPUB 3.2

**For Conversion:**
- EPUB 2.0.1 → EPUB 3.0 (automatic conversion available)

> **Note**: This tool only supports validation and accessibility fixing of EPUB 3.0+ files. If you have an EPUB 2.0 file, the tool will automatically offer to convert it to EPUB 3.0 format first.

## Error Handling

The tool includes comprehensive error handling:

- Invalid EPUB files are detected early
- Partial fixes are applied even if some operations fail
- Detailed error logs help with troubleshooting
- Temporary files are always cleaned up

## Development

### Building from Source

```bash
git clone https://github.com/your-repo/epub-accessibility-fixer.git
cd epub-accessibility-fixer
npm install
npm run build
```

### Running Tests

```bash
npm test
```

### Development Mode

```bash
npm run dev input.epub
```

## Troubleshooting

### Java Not Found

```bash
# Install Java (macOS with Homebrew)
brew install openjdk@11

# Install Java (Ubuntu/Debian)
sudo apt install openjdk-11-jdk

# Install Java (Windows)
# Download from https://adoptopenjdk.net/
```

### Permission Issues

```bash
# Fix permissions (Unix systems)
chmod +x node_modules/.bin/epub-fix
```

### Tool Installation Issues

```bash
# Manually install tools
epub-fix install-tools --verbose
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Credits

- Built on top of [EpubCheck](https://github.com/w3c/epubcheck) by W3C
- Uses [DAISY ACE](https://github.com/daisy/ace) for accessibility analysis
- Inspired by the accessibility guidelines from the [DAISY Consortium](https://daisy.org/)

## Related Tools

- [EpubCheck](https://github.com/w3c/epubcheck) - EPUB validation
- [DAISY ACE](https://github.com/daisy/ace) - Accessibility checking
- [Sigil](https://sigil-ebook.com/) - EPUB editor
- [Calibre](https://calibre-ebook.com/) - EPUB management

## Support

For issues and questions:

- GitHub Issues: [Report bugs and feature requests](https://github.com/your-repo/epub-accessibility-fixer/issues)
- Documentation: [Full documentation](https://github.com/your-repo/epub-accessibility-fixer/wiki)

---

**Note**: This tool aims to automatically fix as many issues as possible, but some accessibility improvements may require human judgment. Always review the generated reports and test your EPUBs with actual assistive technologies.