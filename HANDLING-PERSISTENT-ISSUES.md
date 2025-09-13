# Handling Persistent Issues in EPUB 2 to 3 Conversion

This guide explains how to address common issues that persist after converting EPUB 2.0 files to EPUB 3.0 format, using the EPUB Accessibility Fixer tool.

## Common Persistent Issues

After converting an EPUB 2.0 file to EPUB 3.0, you may still encounter several types of issues:

### 1. Validation Issues (EpubCheck)
- **RSC-005**: Invalid attributes or elements in the OPF file
- **RSC-006**: Remote resource references that must be embedded
- **OPF-014**: Missing "remote-resources" property declaration
- **HTML Structure**: Invalid meta tags, DOCTYPE declarations

### 2. Accessibility Issues (DAISY ACE)
- **Metadata Issues**: Missing accessibility metadata properties
- **epub:type Mapping**: Missing ARIA role attributes for epub:type elements
- **Link Accessibility**: Links with insufficient descriptive text
- **Landmark Issues**: Non-unique landmark elements

## Enhanced Fixing Capabilities

The tool now includes several enhancements to better handle persistent issues:

### Retry Mechanism
Issues are now attempted multiple times (default: 3 attempts) before being marked as persistent. This helps with issues that may be resolved by changes made during previous fixing attempts.

### Persistent Issue Categorization
Issues that remain after all fixing attempts are categorized by type (validation, accessibility, metadata, structural, other) for easier analysis.

### Detailed Reporting
Persistent issues now include detailed information about why they couldn't be fixed automatically and guidance for manual intervention.

See [PERSISTENT-ISSUES-HANDLING-ENHANCEMENTS.md](file:///Users/crdjm/Dev/qoder/PERSISTENT-ISSUES-HANDLING-ENHANCEMENTS.md) for technical details about these enhancements.

## Recommended Workflow

### Step 1: Convert EPUB 2.0 to EPUB 3.0

```bash
epub-fix convert input.epub -o output_epub3.epub
```

### Step 2: Analyze the Converted EPUB

```bash
epub-fix output_epub3.epub --analyze-only --keep-output --verbose
```

This will generate detailed reports showing the remaining issues.

### Step 3: Fix the Converted EPUB

```bash
epub-fix output_epub3.epub --output output_fixed.epub --report report.html --verify --keep-output
```

### Step 4: Review Results

Check the generated reports and verification output to see which issues were resolved.

## Specific Issue Handling

### RSC-005: Invalid Attributes
The tool now handles:
- Removing invalid `opf:role` attributes from OPF files
- Fixing `http-equiv` meta tag values
- Removing EPUB 2.0-specific attributes

### RSC-006: Remote Resources
Note: Remote resources require manual handling as they need to be downloaded and embedded in the EPUB.

### OPF-014: Missing "remote-resources" Property
The tool automatically adds this property to the first HTML item in the manifest.

### Metadata Accessibility Issues
The tool adds missing Schema.org accessibility metadata:
- `schema:accessMode`
- `schema:accessModeSufficient`
- `schema:accessibilityFeature`

### epub:type to ARIA Role Mapping
The enhanced fixer now:
- Maps common epub:type values to appropriate ARIA roles
- Ensures landmark elements have unique accessible names
- Adds default roles for common elements without mappings

### Link Accessibility
The enhanced link fixer:
- Adds `aria-label` or `title` attributes to links with no text
- Improves context for links in text blocks

## Advanced Options for Persistent Issues

### Dry Run Analysis
See what issues can be fixed without making changes:

```bash
epub-fix output_epub3.epub --dry-run --verbose
```

### Configuration Customization
Create a custom configuration file to enable/disable specific fixers:

```json
{
  "enabledFixers": [
    "validation-structure",
    "metadata-accessibility",
    "epub-type-role",
    "link-accessibility-enhanced"
  ]
}
```

Then use it with:

```bash
epub-fix output_epub3.epub --config custom-config.json
```

## Manual Intervention for Complex Issues

Some issues require manual intervention:

### Remote Resources (RSC-006)
1. Identify remote resources in the EpubCheck report
2. Download and save them locally in the EPUB structure
3. Update HTML references to point to local resources
4. Add the files to the EPUB manifest

### Complex epub:type Mappings
If specific epub:type values aren't properly mapped:
1. Check the EPUB Type Role Fixer mapping table
2. Add missing mappings as needed
3. Re-run the fixer

## Verification and Quality Assurance

Always use the `--verify` option to re-run validation tools on the fixed EPUB:

```bash
epub-fix output_epub3.epub --output final.epub --verify --keep-output
```

This creates a timestamped verification directory with:
- EpubCheck results on the fixed EPUB
- DAISY ACE results on the fixed EPUB
- Comparison reports showing issue resolution

## Troubleshooting Tips

1. **Enable Verbose Output**: Use `--verbose` to see detailed logs of what the tool is doing
2. **Check Individual Fixers**: Use `--dry-run` to see which issues each fixer can address
3. **Review Generated Reports**: HTML reports provide detailed information about remaining issues
4. **Examine Raw Output**: Use `--keep-output` to preserve EpubCheck and DAISY ACE raw output for detailed analysis

## Example Workflow for Informal-Calculus EPUB

For an EPUB like `Informal-Calculus-1629840466.epub`:

```bash
# Step 1: Convert to EPUB 3
epub-fix convert Informal-Calculus-1629840466.epub -o Informal-Calculus-1629840466_epub3.epub

# Step 2: Analyze the converted file
epub-fix Informal-Calculus-1629840466_epub3.epub --analyze-only --keep-output --report initial_report.html

# Step 3: Fix issues
epub-fix Informal-Calculus-1629840466_epub3.epub --output Informal-Calculus-1629840466_fixed.epub --report final_report.html --verify --keep-output

# Step 4: Check verification results in the timestamped verification directory
```

This approach should resolve most of the persistent issues in EPUB files after conversion.