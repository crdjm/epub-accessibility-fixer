import { ValidationIssue, FixResult, ProcessingContext, EpubContent, AIImageAnalysis } from '../types';
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
        model?: string;
        source?: string;
        imageSize?: number;
        imageFormat?: string;
        [key: string]: any;
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
                    const fixed = await this.fixAltTextInFile(content, context);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                    }
                }
            } else {
                // Fix all content files
                const contentFiles = this.getAllContentFiles(context);

                for (const content of contentFiles) {
                    const fixed = await this.fixAltTextInFile(content, context);
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

    private async fixAltTextInFile(content: EpubContent, context: ProcessingContext): Promise<number> {
        const $ = this.loadDocument(content);
        let fixedCount = 0;

        // Process images sequentially to avoid async issues
        const images = $('img').toArray();
        this.logger.info(`Found ${images.length} images in ${content.path}`);

        for (const imgElement of images) {
            const $img = $(imgElement);
            const existingAlt = $img.attr('alt');
            const src = $img.attr('src') || '';
            
            this.logger.info(`Processing image: ${src}, existing alt: "${existingAlt || 'none'}"`);

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
                    const altText = await this.generateMeaningfulAltText($img, $, content, src, context);
                    $img.attr('alt', altText);
                    fixedCount++;
                    this.logger.info(`Added alt text "${altText}" for image: ${src}`);
                }
            }
        }

        if (fixedCount > 0) {
            this.saveDocument($, content);
        }
        
        // Log summary of AI analyses stored
        const aiCount = context.aiImageAnalyses ? context.aiImageAnalyses.length : 0;
        this.logger.info(`Processed ${images.length} images, fixed ${fixedCount}, stored ${aiCount} AI analyses for review`);

        return fixedCount;
    }

    private async generateMeaningfulAltText($img: Cheerio, $: CheerioStatic, content: EpubContent, src: string, context: ProcessingContext): Promise<string> {
        const title = $img.attr('title') || '';
        const className = $img.attr('class') || '';

        // Initialize AI analyses array if not exists
        if (!context.aiImageAnalyses) {
            context.aiImageAnalyses = [];
        }

        // First, try to analyze the actual image content with AI/OCR
        this.logger.info(`Attempting AI analysis for image: ${src}`);
        const imageAnalysis = await this.analyzeImageContent(content, src, context);
        
        // Debug logging for analysis results
        if (imageAnalysis) {
            this.logger.info(`AI analysis result for ${src}: confidence=${imageAnalysis.confidence}, description="${imageAnalysis.description}"`);
        } else {
            this.logger.info(`No AI analysis result for ${src}`);
        }
        
        // Always store AI analysis results for review, regardless of confidence or content
        if (imageAnalysis && imageAnalysis.description) {
            const finalDescription = imageAnalysis.confidence <= 0.6 ? 
                `${imageAnalysis.description} (auto-generated)` : 
                imageAnalysis.description;
            await this.storeAIAnalysisResult(src, finalDescription, imageAnalysis, context, content.path);
            this.logger.info(`Stored AI analysis for review: ${src} -> "${finalDescription}"`);
        }
        
        if (imageAnalysis && imageAnalysis.confidence > 0.6) {
            // Combine AI analysis with contextual information
            const contextualInfo = this.getContextualInfo($img, $);
            if (contextualInfo) {
                return `${imageAnalysis.description} ${contextualInfo}`;
            }
            return imageAnalysis.description;
        }

        // If AI analysis has low confidence, try to enhance with context
        if (imageAnalysis && imageAnalysis.confidence > 0.3) {
            const contextualInfo = this.getContextualInfo($img, $);
            if (contextualInfo) {
                return `${imageAnalysis.description} (${contextualInfo})`;
            }
            return `${imageAnalysis.description} (auto-generated)`;
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

        // Final fallback - use stored AI analysis if available, otherwise provide default
        if (imageAnalysis && imageAnalysis.description && imageAnalysis.description !== 'Image') {
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
    private async analyzeImageContent(content: EpubContent, src: string, context: ProcessingContext): Promise<ImageAnalysisResult | null> {
        try {
            // Get absolute path to the image file
            const imagePath = await this.resolveImagePath(content, src, context);
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
     * Resolve the absolute path to an image file in the extracted EPUB
     */
    private async resolveImagePath(content: EpubContent, src: string, context: ProcessingContext): Promise<string | null> {
        try {
            // Get the temp directory from the processing context
            const tempDir = context.tempDir;
            
            // Normalize the src path (remove leading slash if present)
            const normalizedSrc = src.startsWith('/') ? src.substring(1) : src;
            
            // Try different path combinations
            const alternatives = [
                path.join(tempDir, normalizedSrc),
                path.join(tempDir, src),
                path.join(tempDir, path.basename(src)),
                path.join(tempDir, 'images', path.basename(src)),
                path.join(tempDir, 'Images', path.basename(src)),
                path.join(tempDir, 'OEBPS', normalizedSrc),
                path.join(tempDir, 'OEBPS/images', path.basename(src)),
                path.join(path.dirname(content.path), normalizedSrc),
                path.join(path.dirname(content.path), src)
            ];
            
            for (const altPath of alternatives) {
                if (await fs.pathExists(altPath)) {
                    this.logger.info(`Found image at: ${altPath}`);
                    return altPath;
                }
            }
            
            this.logger.warn(`Image not found: ${src} (tried ${alternatives.length} paths)`);
            return null;
            
        } catch (error) {
            this.logger.error(`Failed to resolve image path for ${src}: ${error}`);
            return null;
        }
    }

    /**
     * Try local AI analysis using Ollama with vision models
     */
    private async tryLocalAIAnalysis(imagePath: string): Promise<ImageAnalysisResult | null> {
        try {
            // Check if Ollama is available
            const hasOllama = await this.checkOllamaAvailability();
            if (!hasOllama) {
                this.logger.info('Ollama not available for local image analysis');
                return null;
            }

            // Check if we have a vision-capable model
            const visionModel = await this.findVisionModel();
            if (!visionModel) {
                this.logger.info('No vision-capable model found in Ollama');
                return null;
            }
            
            this.logger.info(`Using vision model: ${visionModel}`);

            // Use Ollama to analyze the image
            const analysis = await this.analyzeImageWithOllama(imagePath, visionModel);
            if (analysis) {
                return {
                    description: analysis.description,
                    confidence: analysis.confidence,
                    source: 'ai',
                    details: analysis.details
                };
            }

            return null;

        } catch (error) {
            this.logger.error(`Ollama image analysis failed: ${error}`);
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

    /**
     * Check if Ollama is available and find vision-capable models
     */
    async checkOllamaAvailability(): Promise<boolean> {
        try {
            this.logger.info('Checking Ollama availability...');
            // Check if Ollama is running
            const response = await axios.get('http://localhost:11434/api/tags', {
                timeout: 5000
            });
            
            if (response.data && response.data.models && response.data.models.length > 0) {
                this.logger.info(`Ollama is available with ${response.data.models.length} models`);
                return true;
            } else {
                this.logger.warn('Ollama is running but no models found');
                return false;
            }
        } catch (error: any) {
            if (error.code === 'ECONNREFUSED') {
                this.logger.info('Ollama is not running (connection refused)');
            } else if (error.code === 'ETIMEDOUT') {
                this.logger.warn('Ollama connection timed out');
            } else {
                this.logger.warn(`Ollama check failed: ${error.message}`);
            }
            return false;
        }
    }

    /**
     * Find a vision-capable model in Ollama by checking actual capabilities
     */
    async findVisionModel(): Promise<string | null> {
        try {
            const response = await axios.get('http://localhost:11434/api/tags', {
                timeout: 5000
            });
            
            if (response.data && response.data.models) {
                this.logger.info(`Checking ${response.data.models.length} models for vision capabilities...`);
                
                // Check each model for vision capabilities
                for (const model of response.data.models) {
                    try {
                        // Use the show API to check model capabilities
                        const showResponse = await axios.post('http://localhost:11434/api/show', {
                            name: model.name
                        }, {
                            timeout: 10000
                        });
                        
                        if (showResponse.data && showResponse.data.capabilities) {
                            const capabilities = showResponse.data.capabilities;
                            this.logger.info(`Model ${model.name} capabilities: ${capabilities.join(', ')}`);
                            
                            if (capabilities.includes('vision')) {
                                this.logger.info(`Found vision-capable model: ${model.name}`);
                                return model.name;
                            }
                        }
                    } catch (error) {
                        this.logger.warn(`Failed to check capabilities for ${model.name}: ${error}`);
                        // Continue checking other models
                    }
                }
                
                // If no vision models found via API, fall back to known model patterns
                this.logger.info('No vision capabilities detected via API, checking known vision model patterns...');
                const knownVisionModels = [
                    'moondream:latest', 'moondream:1.8b', 'moondream:7b',
                    'llava:latest', 'llava:13b', 'llava:7b', 
                    'bakllava:latest', 'bakllava:7b'
                ];
                
                for (const modelName of knownVisionModels) {
                    const found = response.data.models.find((model: any) => 
                        model.name === modelName || model.name.startsWith(modelName.split(':')[0])
                    );
                    if (found) {
                        this.logger.info(`Found known vision model: ${found.name}`);
                        return found.name;
                    }
                }
                
                this.logger.info(`No vision-capable models found. Available models: ${response.data.models.map((m: any) => m.name).join(', ')}`);
            }
            
            return null;
        } catch (error) {
            this.logger.error(`Error finding vision model: ${error}`);
            return null;
        }
    }

    /**
     * Analyze image using Ollama with vision capabilities
     */
    private async analyzeImageWithOllama(imagePath: string, modelName: string): Promise<{
        description: string;
        confidence: number;
        details?: any;
    } | null> {
        try {
            // Verify image file exists and get info
            const stats = await fs.stat(imagePath);
            this.logger.info(`Reading image file: ${imagePath} (${stats.size} bytes)`);
            
            // Convert image to base64
            const imageBuffer = await fs.readFile(imagePath);
            const base64Image = imageBuffer.toString('base64');
            
            // Log first few characters of base64 to verify it's different for each image
            const base64Preview = base64Image.substring(0, 50);
            this.logger.info(`Base64 preview for ${path.basename(imagePath)}: ${base64Preview}...`);
            
            // Get image format from file extension
            const ext = path.extname(imagePath).toLowerCase();
            const mimeType = this.getMimeType(ext);
            this.logger.info(`Image format: ${ext} -> ${mimeType}`);
            
            // Create a prompt optimized for vision models
            const prompt = `Create alt text for this EPUB image that will help screen reader users understand the visual content.

Focus on:
- Character names and their actions/expressions  
- Important visual elements for the story
- Setting details that matter to understanding

Avoid starting with "image of" or "picture of". Be descriptive but concise.

Final alt text:`;

            this.logger.info(`Sending image analysis request to vision model: ${modelName}...`);
            
            // Make request to Ollama with optimized parameters and retry logic
            let retries = 2;
            let lastError: any;
            let response: any;
            
            while (retries >= 0) {
                try {
                    response = await axios.post('http://localhost:11434/api/generate', {
                        model: modelName,
                        prompt: prompt,
                        images: [base64Image],
                        stream: false,
                        options: {
                            temperature: 0.3, // Allow some creativity for better descriptions
                            top_p: 0.9,
                            top_k: 50,
                            num_predict: 150, // Standard limit for vision models
                            repeat_penalty: 1.1,
                            seed: Math.floor(Math.random() * 1000000) // Random seed to avoid cached responses
                        }
                    }, {
                        timeout: 60000, // 1 minute timeout for vision models
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    // Success - break out of retry loop
                    break;
                    
                } catch (error: any) {
                    lastError = error;
                    retries--;
                    
                    if (error.code === 'ECONNREFUSED') {
                        this.logger.warn(`Ollama connection refused for ${path.basename(imagePath)} (${retries} retries left)`);
                    } else if (error.code === 'ETIMEDOUT') {
                        this.logger.warn(`Ollama request timed out for ${path.basename(imagePath)} (${retries} retries left)`);
                    } else {
                        this.logger.warn(`Ollama request failed for ${path.basename(imagePath)}: ${error.message} (${retries} retries left)`);
                    }
                    
                    if (retries >= 0) {
                        // Wait before retry
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }
            
            // If we exhausted retries, throw the last error
            if (retries < 0) {
                throw lastError;
            }

            if (response.data && response.data.response) {
                const analysisText = response.data.response.trim();
                
                // Check if response is empty
                if (!analysisText) {
                    this.logger.warn(`Ollama returned empty response for ${path.basename(imagePath)}`);
                    return null;
                }
                
                this.logger.info(`Raw Ollama response for ${path.basename(imagePath)}: "${analysisText}"`);
                
                // Clean up the response
                let description = analysisText;
                
                // Look for alt text after common prefixes
                const altTextPrefixes = [
                    'Final alt text:',
                    'final alt text:',
                    'Alt text:',
                    'alt text:',
                    'Description:',
                    'Image description:'
                ];
                
                for (const prefix of altTextPrefixes) {
                    if (description.includes(prefix)) {
                        const afterPrefix = description.split(prefix).pop();
                        if (afterPrefix && afterPrefix.trim()) {
                            description = afterPrefix.trim();
                            this.logger.info(`Extracted alt text using prefix "${prefix}": "${description}"`);
                            break;
                        }
                    }
                }
                
                // Clean up the response
                description = description
                    .replace(/^["']|["']$/g, '') // Remove quotes
                    .replace(/\n+/g, ' ') // Replace newlines with spaces
                    .replace(/\s+/g, ' ') // Normalize whitespace
                    .trim();
                
                // Filter out generic or unhelpful descriptions
                const genericPhrases = [
                    'this is an image',
                    'the image shows',
                    'this image contains',
                    'the picture depicts',
                    'this illustration',
                    'a colorful illustration',
                    'an image of'
                ];
                
                // Remove generic prefixes
                for (const phrase of genericPhrases) {
                    if (description.toLowerCase().startsWith(phrase)) {
                        description = description.substring(phrase.length).trim();
                        break;
                    }
                }
                
                // Check for responses indicating the model didn't receive the image
                const noImageIndicators = [
                    'please provide the image',
                    'describe it for me',
                    'i cannot see',
                    'no image provided',
                    'unable to see'
                ];
                
                const hasNoImageIndicator = noImageIndicators.some(indicator => 
                    description.toLowerCase().includes(indicator)
                );
                
                if (hasNoImageIndicator) {
                    this.logger.warn(`Model indicates it cannot see the image for ${path.basename(imagePath)}: "${description}"`);
                    return null;
                }
                
                // Ensure the description is reasonable length and quality
                if (description.length > 5 && description.length < 400) {
                    // Capitalize first letter if needed
                    if (description.length > 0) {
                        description = description.charAt(0).toUpperCase() + description.slice(1);
                    }
                    
                    // Remove any trailing periods and add one
                    description = description.replace(/\.+$/, '') + '.';
                    
                    this.logger.info(`Final processed description for ${path.basename(imagePath)}: "${description}"`);
                    
                    return {
                        description: description,
                        confidence: 0.85, // High confidence for AI analysis
                        details: {
                            model: modelName,
                            source: 'ollama',
                            imageSize: stats.size,
                            imageFormat: ext,
                            base64Length: base64Image.length
                        }
                    };
                }
                
                this.logger.warn(`Ollama response too short or long for ${path.basename(imagePath)}: "${analysisText}"`);
            } else {
                this.logger.error(`No response data from Ollama for ${path.basename(imagePath)}. Response: ${JSON.stringify(response.data)}`);
                
                // Check if it's a connection issue
                if (!response.data) {
                    this.logger.error('Ollama response is completely empty - possible connection issue');
                }
            }
            
            return null;
            
        } catch (error) {
            this.logger.error(`Ollama image analysis failed for ${path.basename(imagePath)}: ${error}`);
            return null;
        }
    }

    /**
     * Get MIME type from file extension
     */
    private getMimeType(ext: string): string {
        const mimeTypes: { [key: string]: string } = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.bmp': 'image/bmp',
            '.svg': 'image/svg+xml'
        };
        
        return mimeTypes[ext] || 'image/jpeg';
    }

    /**
     * Store AI analysis result for review page generation
     */
    private async storeAIAnalysisResult(
        originalSrc: string, 
        generatedAltText: string, 
        analysis: ImageAnalysisResult, 
        context: ProcessingContext,
        htmlFilePath: string
    ): Promise<void> {
        try {
            // Get the actual image path
            const imagePath = await this.resolveImagePath(
                { path: '', content: '', mediaType: '', modified: false }, 
                originalSrc, 
                context
            );
            
            if (!imagePath || !fs.existsSync(imagePath)) {
                this.logger.warn(`Cannot store AI analysis - image not found: ${originalSrc}`);
                return;
            }

            // Read image and convert to base64 for embedding in review page
            const imageBuffer = await fs.readFile(imagePath);
            const imageExtension = path.extname(imagePath).toLowerCase();
            const mimeType = this.getMimeType(imageExtension);
            const imageData = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

            const aiAnalysis: AIImageAnalysis = {
                imagePath,
                originalSrc,
                htmlFilePath,
                generatedAltText,
                analysisMethod: analysis.source as 'ai' | 'ocr' | 'metadata',
                confidence: analysis.confidence,
                model: analysis.details?.model || analysis.details?.source,
                timestamp: new Date().toISOString(),
                imageData,
                details: analysis.details
            };

            // Initialize the array if it doesn't exist
            if (!context.aiImageAnalyses) {
                context.aiImageAnalyses = [];
            }

            context.aiImageAnalyses.push(aiAnalysis);
            this.logger.info(`Stored AI analysis for review: ${originalSrc} -> "${generatedAltText}"`);

        } catch (error) {
            this.logger.error(`Failed to store AI analysis result for ${originalSrc}: ${error}`);
        }
    }
}