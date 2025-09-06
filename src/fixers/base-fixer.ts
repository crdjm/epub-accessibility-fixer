import { ValidationIssue, FixResult, ProcessingContext, EpubContent } from '../types';
import { Logger } from '../utils/common';
import * as cheerio from 'cheerio';

type CheerioStatic = ReturnType<typeof cheerio.load>;
type CheerioElement = any;
type Cheerio = any;

export abstract class BaseFixer {
    protected logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    abstract getFixerName(): string;
    abstract getHandledCodes(): string[];
    abstract canFix(issue: ValidationIssue): boolean;
    abstract fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult>;

    protected loadDocument(content: EpubContent): CheerioStatic {
        // Only load text-based content, not binary content
        if (content.content instanceof Buffer) {
            throw new Error(`Cannot load binary file as document: ${content.path}`);
        }

        return cheerio.load(content.content, {
            xmlMode: true
        });
    }

    protected saveDocument($: CheerioStatic, content: EpubContent): void {
        // Only save if content is string-based (not binary)
        if (content.content instanceof Buffer) {
            throw new Error(`Cannot save binary file as document: ${content.path}`);
        }

        // For XML documents like OPF and XHTML, use proper XML serialization
        // Check if this is an XML document (EPUB XHTML files are XML)
        if (content.mediaType === 'application/oebps-package+xml' || 
            content.path.endsWith('.opf') || 
            content.mediaType === 'application/xhtml+xml' || 
            content.path.endsWith('.xhtml')) {
            // For XML/XHTML files, we need to preserve XML structure and self-closing tags
            // Use XML mode to properly serialize
            content.content = $.xml();
            // Ensure proper XML declaration if missing
            if (typeof content.content === 'string' && !content.content.startsWith('<?xml')) {
                content.content = '<?xml version="1.0" encoding="UTF-8"?>\n' + content.content;
            }
        } else {
            content.content = $.html();
        }
        content.modified = true;
    }

    protected createFixResult(success: boolean, message: string, changedFiles?: string[], details?: any): FixResult {
        // If details contains fixDetails, make sure they're properly included in the result
        if (details && details.fixDetails) {
            return {
                success,
                message,
                changedFiles,
                details,
                fixDetails: details.fixDetails
            };
        }
        
        return {
            success,
            message,
            changedFiles,
            details
        };
    }

    protected findContentByPath(context: ProcessingContext, filePath: string): EpubContent | undefined {
        // First try exact match
        let content = context.contents.get(filePath);
        if (content) {
            return content;
        }

        // Try to find by filename only (in case path doesn't match exactly)
        const fileName = filePath.split('/').pop() || filePath;

        for (const [path, contentItem] of context.contents) {
            if (path.endsWith(fileName) || path.endsWith(filePath)) {
                this.logger.info(`Found content by partial match: ${path} for requested ${filePath}`);
                return contentItem;
            }
        }

        // Try case-insensitive search
        const lowerFilePath = filePath.toLowerCase();
        for (const [path, contentItem] of context.contents) {
            if (path.toLowerCase() === lowerFilePath || path.toLowerCase().endsWith(fileName.toLowerCase())) {
                this.logger.info(`Found content by case-insensitive match: ${path} for requested ${filePath}`);
                return contentItem;
            }
        }

        this.logger.warn(`Content not found for path: ${filePath}`);
        return undefined;
    }

    protected getAllContentFiles(context: ProcessingContext): EpubContent[] {
        const contentFiles: EpubContent[] = [];

        for (const item of context.manifest.items) {
            if (item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html') {
                const content = context.contents.get(item.href);
                if (content && typeof content.content === 'string') {
                    contentFiles.push(content);
                }
            }
        }

        return contentFiles;
    }

    protected generateDefaultAltText(imgSrc: string, context?: any): string {
        // Generate meaningful alt text based on image filename and context
        const filename = imgSrc.split('/').pop()?.split('.')[0] || 'image';

        // Clean up filename for better alt text
        const cleaned = filename
            .replace(/[-_]/g, ' ')
            .replace(/\d+/g, '')
            .trim()
            .toLowerCase();

        if (cleaned) {
            return `Image: ${cleaned}`;
        }

        return 'Image';
    }

    protected isDecorativeImage(imgElement: CheerioElement, $: CheerioStatic): boolean {
        const $img = $(imgElement);
        const src = $img.attr('src') || '';
        const className = $img.attr('class') || '';
        const parent = $img.parent();

        // Check for decorative indicators
        const decorativePatterns = [
            /decoration/i,
            /ornament/i,
            /border/i,
            /spacer/i,
            /bullet/i,
            /icon-/i,
            /bg-/i,
            /background/i
        ];

        // Check filename
        if (decorativePatterns.some(pattern => pattern.test(src))) {
            return true;
        }

        // Check class names
        if (decorativePatterns.some(pattern => pattern.test(className))) {
            return true;
        }

        // Check if image is very small (likely decorative)
        const width = $img.attr('width');
        const height = $img.attr('height');
        if (width && height) {
            const w = parseInt(width);
            const h = parseInt(height);
            if (w <= 10 || h <= 10) {
                return true;
            }
        }

        // Check if inside a link with text
        const linkParent = $img.closest('a');
        if (linkParent.length > 0) {
            const linkText = linkParent.text().trim();
            if (linkText && linkText.length > 0) {
                return true; // Image is decorative if link has text
            }
        }

        return false;
    }

    protected sanitizeId(text: string): string {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 50);
    }

    protected findOrCreateNavFile(context: ProcessingContext): EpubContent | null {
        // Look for existing nav file
        for (const item of context.manifest.items) {
            if (item.properties && item.properties.includes('nav')) {
                const content = context.contents.get(item.href);
                if (content) {
                    return content;
                }
            }
        }

        // Look for file named nav.xhtml or similar
        const navCandidates = ['nav.xhtml', 'navigation.xhtml', 'toc.xhtml'];
        for (const candidate of navCandidates) {
            const content = context.contents.get(candidate);
            if (content) {
                return content;
            }
        }

        return null;
    }

    protected ensureUniqueId($: CheerioStatic, proposedId: string): string {
        let id = proposedId;
        let counter = 1;

        while ($(`#${id}`).length > 0) {
            id = `${proposedId}-${counter}`;
            counter++;
        }

        return id;
    }
}