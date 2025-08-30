import { ValidationIssue, FixResult, ProcessingContext, EpubContent } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';
import * as fs from 'fs-extra';
import * as path from 'path';
import { execSync } from 'child_process';
import axios from 'axios';

type Cheerio = any;
type CheerioStatic = any;

interface ImageAnalysisResult {
    description: string;
    confidence: number;
    source: 'ai' | 'filename' | 'context' | 'default';
    details?: {
        objects?: string[];
        text?: string;
        colors?: string[];
        setting?: string;
    };
}

export class AltTextFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Alt Text Fixer';
    }

    getHandledCodes(): string[] {
        return ['missing-alt-text', 'image-alt', 'ACC-002'];
    }

    canFix(issue: ValidationIssue): boolean {
        return this.getHandledCodes().some(code => issue.code.includes(code));
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing missing alt text: ${issue.message}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                const content = this.findContentByPath(context, issue.location.file);
                if (content) {
                    const fixed = await this.fixAltTextInFile(content);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                    }
                }
            } else {
                // Fix all content files
                const contentFiles = this.getAllContentFiles(context);

                for (const content of contentFiles) {
                    const fixed = await this.fixAltTextInFile(content);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                    }
                }
            }

            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Added alt text to ${totalFixed} images`,
                    changedFiles,
                    { imagesFixed: totalFixed }
                );
            } else {
                return this.createFixResult(
                    false,
                    'No images found that needed alt text fixes'
                );
            }

        } catch (error) {
            this.logger.error(`Alt text fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix alt text: ${error}`);
        }
    }

    private async fixAltTextInFile(content: EpubContent): Promise<number> {
        const $ = this.loadDocument(content);
        let fixedCount = 0;

        // Process images sequentially to avoid async issues
        const images = $('img').toArray();

        for (const imgElement of images) {
            const $img = $(imgElement);
            const existingAlt = $img.attr('alt');

            // Only fix if alt attribute is missing or empty
            if (!existingAlt || existingAlt.trim() === '') {
                const src = $img.attr('src') || '';

                if (this.isDecorativeImage(imgElement, $)) {
                    // Add empty alt for decorative images
                    $img.attr('alt', '');
                    fixedCount++;
                    this.logger.info(`Added empty alt attribute for decorative image: ${src}`);
                } else {
                    // Generate meaningful alt text with enhanced analysis
                    const altText = await this.generateMeaningfulAltText($img, $, content, src);
                    $img.attr('alt', altText);
                    fixedCount++;
                    this.logger.info(`Added alt text "${altText}" for image: ${src}`);
                }
            }
        }

        if (fixedCount > 0) {
            this.saveDocument($, content);
        }

        return fixedCount;
    }

    private async generateMeaningfulAltText($img: Cheerio, $: CheerioStatic, content: EpubContent, src: string): Promise<string> {
        const title = $img.attr('title') || '';
        const className = $img.attr('class') || '';

        // First, try to analyze the actual image content
        const imageAnalysis = await this.analyzeImageContent(content, src);
        if (imageAnalysis && imageAnalysis.confidence > 0.7) {
            // Combine AI analysis with contextual information
            const contextualInfo = this.getContextualInfo($img, $);
            if (contextualInfo) {
                return `${imageAnalysis.description}. ${contextualInfo}`;
            }
            return imageAnalysis.description;
        }

        // Use title if available
        if (title && title.trim()) {
            return title.trim();
        }

        // Check for figure caption
        const figure = $img.closest('figure');
        if (figure.length > 0) {
            const caption = figure.find('figcaption').text().trim();
            if (caption) {
                return caption;
            }
        }

        // Check surrounding context
        const parentText = $img.parent().text().replace($img.text(), '').trim();
        if (parentText && parentText.length > 0 && parentText.length < 100) {
            return `Image related to: ${parentText}`;
        }

        // Check for nearby headings
        const nearbyHeading = $img.prevAll('h1, h2, h3, h4, h5, h6').first().text().trim();
        if (nearbyHeading) {
            return `Image for section: ${nearbyHeading}`;
        }

        // Check if image is in a link
        const linkParent = $img.closest('a');
        if (linkParent.length > 0) {
            const href = linkParent.attr('href');
            if (href) {
                return `Link to ${href}`;
            }
        }

        // Analyze filename for context
        const altFromFilename = this.generateAltFromFilename(src);
        if (altFromFilename !== 'Image') {
            return altFromFilename;
        }

        // Check for semantic meaning based on class
        const semanticAlt = this.generateAltFromClass(className);
        if (semanticAlt) {
            return semanticAlt;
        }

        // Final fallback - include image analysis if available, even with low confidence
        if (imageAnalysis && imageAnalysis.confidence > 0.3) {
            return `${imageAnalysis.description} (auto-generated)`;
        }

        // Default fallback
        return 'Image';
    }

    private generateAltFromFilename(src: string): string {
        const filename = src.split('/').pop()?.split('.')[0] || '';

        // Clean up common filename patterns
        let cleaned = filename
            .replace(/[-_]/g, ' ')
            .replace(/\d{3,}/g, '') // Remove long numbers
            .replace(/img|image|pic|photo|fig|figure/gi, '')
            .trim();

        // Handle common prefixes/patterns
        const patterns = [
            { pattern: /^cover/i, replacement: 'Book cover' },
            { pattern: /^title/i, replacement: 'Title page' },
            { pattern: /^author/i, replacement: 'Author photo' },
            { pattern: /^chart|graph|plot/i, replacement: 'Chart' },
            { pattern: /^diagram/i, replacement: 'Diagram' },
            { pattern: /^map/i, replacement: 'Map' },
            { pattern: /^table/i, replacement: 'Table' },
            { pattern: /^logo/i, replacement: 'Logo' }
        ];

        for (const { pattern, replacement } of patterns) {
            if (pattern.test(cleaned)) {
                return replacement;
            }
        }

        if (cleaned && cleaned.length > 2) {
            // Capitalize first letter
            cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
            return cleaned;
        }

        return 'Image';
    }

    private generateAltFromClass(className: string): string | null {
        const classes = className.toLowerCase().split(/\s+/);

        const classPatterns = [
            { pattern: /cover/, replacement: 'Book cover' },
            { pattern: /portrait/, replacement: 'Portrait' },
            { pattern: /landscape/, replacement: 'Landscape image' },
            { pattern: /chart|graph/, replacement: 'Chart' },
            { pattern: /diagram/, replacement: 'Diagram' },
            { pattern: /illustration/, replacement: 'Illustration' },
            { pattern: /photo/, replacement: 'Photograph' },
            { pattern: /screenshot/, replacement: 'Screenshot' }
        ];

        for (const cls of classes) {
            for (const { pattern, replacement } of classPatterns) {
                if (pattern.test(cls)) {
                    return replacement;
                }
            }
        }

        return null;
    }

    /**
     * Analyze image content using various methods (AI, OCR, metadata)
     */
    private async analyzeImageContent(content: EpubContent, src: string): Promise<ImageAnalysisResult | null> {
        try {
            // Get absolute path to the image file
            const imagePath = await this.resolveImagePath(content, src);
            if (!imagePath || !fs.existsSync(imagePath)) {
                this.logger.info(`Image file not found: ${imagePath}`);
                return null;
            }

            this.logger.info(`Analyzing image content: ${imagePath}`);

            // Try different analysis methods in order of preference
            let result = await this.tryLocalAIAnalysis(imagePath);
            if (result) return result;

            result = await this.tryOCRAnalysis(imagePath);
            if (result) return result;

            result = await this.tryCloudAIAnalysis(imagePath);
            if (result) return result;

            result = await this.tryImageMetadataAnalysis(imagePath);
            if (result) return result;

            return null;

        } catch (error) {
            this.logger.error(`Image analysis failed for ${src}: ${error}`);
            return null;
        }
    }

    /**
     * Resolve the absolute path to an image file
     */
    private async resolveImagePath(content: EpubContent, src: string): Promise<string | null> {
        try {
            // Handle relative paths from content file
            const contentDir = path.dirname(content.path);
            const absoluteSrc = path.resolve(contentDir, src);

            // Check if file exists
            if (await fs.pathExists(absoluteSrc)) {
                return absoluteSrc;
            }

            // Try relative to EPUB root
            const epubRoot = process.cwd(); // Assuming we're in the extracted EPUB directory
            const rootRelativePath = path.join(epubRoot, src);
            if (await fs.pathExists(rootRelativePath)) {
                return rootRelativePath;
            }

            // Try in common image directories
            const commonDirs = ['images', 'Images', 'img', 'assets', 'media'];
            const filename = path.basename(src);

            for (const dir of commonDirs) {
                const candidatePath = path.join(epubRoot, dir, filename);
                if (await fs.pathExists(candidatePath)) {
                    return candidatePath;
                }
            }

            return null;
        } catch (error) {
            this.logger.error(`Failed to resolve image path for ${src}: ${error}`);
            return null;
        }
    }

    /**
     * Try local AI analysis using models like BLIP, CLIP, or similar
     */
    private async tryLocalAIAnalysis(imagePath: string): Promise<ImageAnalysisResult | null> {
        try {
            // Check if Python and required libraries are available
            const hasPython = await this.checkPythonDependencies();
            if (!hasPython) {
                this.logger.info('Python AI dependencies not available for local image analysis');
                return null;
            }

            // Create a Python script for image analysis
            const pythonScript = this.generateImageAnalysisScript();
            const scriptPath = path.join(process.cwd(), 'temp_image_analysis.py');

            await fs.writeFile(scriptPath, pythonScript);

            try {
                const pythonCmd = this.getPythonCommand();

                // Run the Python script
                const result = execSync(`${pythonCmd} ${scriptPath} "${imagePath}"`, {
                    encoding: 'utf8',
                    timeout: 30000 // 30 second timeout
                });

                const analysis = JSON.parse(result.trim());

                await fs.remove(scriptPath); // Clean up

                return {
                    description: analysis.description,
                    confidence: analysis.confidence,
                    source: 'ai',
                    details: analysis.details
                };

            } catch (execError) {
                await fs.remove(scriptPath); // Clean up on error
                this.logger.info(`Python image analysis failed: ${execError}`);
                return null;
            }

        } catch (error) {
            this.logger.info(`Local AI analysis setup failed: ${error}`);
            return null;
        }
    }

    /**
     * Try OCR analysis to extract text from images
     */
    private async tryOCRAnalysis(imagePath: string): Promise<ImageAnalysisResult | null> {
        try {
            // Check if Tesseract is available
            try {
                execSync('tesseract --version', { encoding: 'utf8', stdio: 'pipe' });
            } catch {
                this.logger.info('Tesseract OCR not available');
                return null;
            }

            // Run OCR on the image
            const ocrResult = execSync(`tesseract "${imagePath}" stdout`, {
                encoding: 'utf8',
                timeout: 15000 // 15 second timeout
            });

            const text = ocrResult.trim();
            if (text && text.length > 10) {
                // Clean up the OCR text
                const cleanText = text
                    .replace(/\n+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (cleanText.length > 5) {
                    return {
                        description: `Image containing text: "${cleanText.substring(0, 100)}${cleanText.length > 100 ? '...' : ''}"`,
                        confidence: 0.8,
                        source: 'ai',
                        details: { text: cleanText }
                    };
                }
            }

            return null;

        } catch (error) {
            this.logger.info(`OCR analysis failed: ${error}`);
            return null;
        }
    }

    /**
     * Try cloud AI services (placeholder for future implementation)
     */
    private async tryCloudAIAnalysis(imagePath: string): Promise<ImageAnalysisResult | null> {
        // This is a placeholder for cloud AI services like:
        // - Google Vision API
        // - Azure Computer Vision
        // - AWS Rekognition
        // - OpenAI Vision API

        // For now, we'll skip cloud analysis to avoid API costs and dependencies
        this.logger.info('Cloud AI analysis not implemented yet');
        return null;
    }

    /**
     * Try extracting useful information from image metadata
     */
    private async tryImageMetadataAnalysis(imagePath: string): Promise<ImageAnalysisResult | null> {
        try {
            // Check if ExifTool is available
            try {
                execSync('exiftool -ver', { encoding: 'utf8', stdio: 'pipe' });
            } catch {
                this.logger.info('ExifTool not available for metadata analysis');
                return null;
            }

            // Extract metadata
            const metadata = execSync(`exiftool -json "${imagePath}"`, {
                encoding: 'utf8',
                timeout: 10000
            });

            const metadataObj = JSON.parse(metadata)[0];

            // Look for useful metadata
            const title = metadataObj.Title || metadataObj.ImageDescription;
            const subject = metadataObj.Subject || metadataObj.Keywords;

            if (title && title.trim()) {
                return {
                    description: title.trim(),
                    confidence: 0.6,
                    source: 'ai',
                    details: { text: title }
                };
            }

            if (subject && subject.trim()) {
                return {
                    description: `Image related to: ${subject.trim()}`,
                    confidence: 0.5,
                    source: 'ai',
                    details: { text: subject }
                };
            }

            return null;

        } catch (error) {
            this.logger.info(`Metadata analysis failed: ${error}`);
            return null;
        }
    }

    /**
     * Get the correct Python command to use
     */
    private getPythonCommand(): string {
        try {
            // Try python3 first (more explicit)
            execSync('python3 --version', { encoding: 'utf8', stdio: 'pipe' });
            return 'python3';
        } catch {
            try {
                // Fall back to python
                execSync('python --version', { encoding: 'utf8', stdio: 'pipe' });
                return 'python';
            } catch {
                // Default to python3 if neither works
                return 'python3';
            }
        }
    }

    /**
     * Check if Python and required AI libraries are available
     */
    private async checkPythonDependencies(): Promise<boolean> {
        try {
            const pythonCmd = this.getPythonCommand();

            // Check Python availability
            execSync(`${pythonCmd} --version`, { encoding: 'utf8', stdio: 'pipe' });

            // Check if required libraries are installed
            const checkScript = `
import sys
try:
    import torch
    import transformers
    import PIL
    print("AVAILABLE")
except ImportError:
    print("NOT_AVAILABLE")
`;

            const result = execSync(`${pythonCmd} -c "${checkScript}"`, {
                encoding: 'utf8',
                stdio: 'pipe'
            });

            return result.trim() === 'AVAILABLE';

        } catch {
            return false;
        }
    }

    /**
     * Generate Python script for image analysis
     */
    private generateImageAnalysisScript(): string {
        return `
import sys
import json
from PIL import Image
try:
    from transformers import BlipProcessor, BlipForConditionalGeneration
    import torch
    
    # Load pre-trained model
    processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
    model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")
    
    # Load and process image
    image_path = sys.argv[1]
    image = Image.open(image_path).convert('RGB')
    
    # Generate caption
    inputs = processor(image, return_tensors="pt")
    out = model.generate(**inputs, max_length=100)
    caption = processor.decode(out[0], skip_special_tokens=True)
    
    # Return structured result
    result = {
        "description": caption,
        "confidence": 0.85,
        "details": {
            "model": "BLIP",
            "image_size": image.size
        }
    }
    
    print(json.dumps(result))
    
except Exception as e:
    # Fallback analysis
    result = {
        "description": "Image analysis unavailable",
        "confidence": 0.1,
        "details": {
            "error": str(e)
        }
    }
    print(json.dumps(result))
`;
    }

    /**
     * Extract contextual information from the surrounding HTML
     */
    private getContextualInfo($img: Cheerio, $: CheerioStatic): string | null {
        // Check for figure caption
        const figure = $img.closest('figure');
        if (figure.length > 0) {
            const caption = figure.find('figcaption').text().trim();
            if (caption) {
                return `Context: ${caption}`;
            }
        }

        // Check for nearby headings
        const nearbyHeading = $img.prevAll('h1, h2, h3, h4, h5, h6').first().text().trim();
        if (nearbyHeading) {
            return `Related to: ${nearbyHeading}`;
        }

        // Check surrounding paragraph text
        const parentP = $img.closest('p');
        if (parentP.length > 0) {
            const pText = parentP.text().replace($img.text(), '').trim();
            if (pText && pText.length > 10 && pText.length < 100) {
                return `Context: ${pText}`;
            }
        }

        return null;
    }

    protected isDecorativeImage(imgElement: any, $: CheerioStatic): boolean {
        const $img = $(imgElement);

        // Check for role="presentation"
        if ($img.attr('role') === 'presentation') {
            return true;
        }

        // Check if image is purely decorative based on context
        const src = $img.attr('src') || '';
        const decorativePatterns = [
            /border|decoration|ornament|divider|separator/i,
            /spacer|blank|transparent/i,
            /bullet|arrow|icon-arrow/i
        ];

        return decorativePatterns.some(pattern => pattern.test(src));
    }
}