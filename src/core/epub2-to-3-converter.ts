import * as path from 'path';
import * as fs from 'fs-extra';
import * as JSZip from 'jszip';
import { Logger } from '../utils/common';
import { EpubVersionDetector } from '../utils/epub-version-detector';

export interface ConversionResult {
    success: boolean;
    outputPath: string;
    changes: string[];
    warnings: string[];
    errors: string[];
}

export class Epub2To3Converter {
    private logger: Logger;
    private versionDetector: EpubVersionDetector;

    constructor(logger: Logger) {
        this.logger = logger;
        this.versionDetector = new EpubVersionDetector(logger);
    }

    /**
     * Convert EPUB 2.0 to EPUB 3.0 format
     */
    async convertEpub2To3(inputPath: string, outputPath: string): Promise<ConversionResult> {
        const result: ConversionResult = {
            success: false,
            outputPath,
            changes: [],
            warnings: [],
            errors: []
        };

        try {
            this.logger.info(`Starting EPUB 2.0 to 3.0 conversion: ${inputPath} → ${outputPath}`);

            // Verify it's actually EPUB 2.0
            const versionInfo = await this.versionDetector.detectVersion(inputPath);
            if (!versionInfo.isEpub2) {
                result.errors.push(`Input file is not EPUB 2.0 (detected: ${versionInfo.version})`);
                return result;
            }

            // Load the EPUB
            const zipBuffer = await fs.readFile(inputPath);
            const zip = await JSZip.loadAsync(zipBuffer);

            // Find and process the OPF file
            const containerFile = zip.file('META-INF/container.xml');
            if (!containerFile) {
                result.errors.push('Invalid EPUB: Missing META-INF/container.xml');
                return result;
            }

            const containerContent = await containerFile.async('string');
            const opfPath = this.extractOpfPath(containerContent);

            if (!opfPath) {
                result.errors.push('Cannot find OPF file path in container.xml');
                return result;
            }

            const opfFile = zip.file(opfPath);
            if (!opfFile) {
                result.errors.push(`OPF file not found: ${opfPath}`);
                return result;
            }

            let opfContent = await opfFile.async('string');

            // Perform EPUB 3.0 conversion
            const conversionResult = await this.performConversion(opfContent, zip, opfPath);

            result.changes.push(...conversionResult.changes);
            result.warnings.push(...conversionResult.warnings);
            result.errors.push(...conversionResult.errors);

            if (conversionResult.errors.length > 0) {
                return result;
            }

            // Update the OPF file in the ZIP
            zip.file(opfPath, conversionResult.opfContent);

            // Add navigation document if needed
            if (conversionResult.navigationDocument) {
                const navPath = this.getNavigationPath(opfPath);
                zip.file(navPath, conversionResult.navigationDocument);
                result.changes.push(`Created navigation document: ${navPath}`);
            }

            // Ensure mimetype is stored uncompressed (EPUB requirement)
            zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

            // Generate the new EPUB with proper mimetype handling
            const buffer = await zip.generateAsync({
                type: 'nodebuffer',
                compression: 'DEFLATE',
                compressionOptions: { level: 9 },
                // Ensure mimetype is stored uncompressed
                streamFiles: true
            });

            await fs.writeFile(outputPath, buffer);

            result.success = true;
            this.logger.success(`Successfully converted EPUB 2.0 to 3.0: ${outputPath}`);

            return result;

        } catch (error) {
            this.logger.error(`Conversion failed: ${error}`);
            result.errors.push(`Conversion failed: ${error}`);
            return result;
        }
    }

    /**
     * Perform the actual EPUB 3.0 conversion
     */
    private async performConversion(opfContent: string, zip: any, opfPath: string): Promise<{
        opfContent: string;
        changes: string[];
        warnings: string[];
        errors: string[];
        navigationDocument?: string;
    }> {
        const changes: string[] = [];
        const warnings: string[] = [];
        const errors: string[] = [];
        let navigationDocument: string | undefined;

        try {
            const cheerio = require('cheerio');
            const $ = cheerio.load(opfContent, { xmlMode: true });

            // 1. Update package element version
            const packageElement = $('package');
            if (packageElement.length === 0) {
                errors.push('No package element found in OPF');
                return { opfContent, changes, warnings, errors };
            }

            packageElement.attr('version', '3.0');
            changes.push('Updated version to 3.0');

            // 2. Update namespace to EPUB 3.0
            const currentXmlns = packageElement.attr('xmlns');
            if (currentXmlns !== 'http://www.idpf.org/2007/opf') {
                packageElement.attr('xmlns', 'http://www.idpf.org/2007/opf');
                changes.push('Updated xmlns to EPUB 3.0 namespace');
            }

            // 3. Add prefix for schema.org metadata
            const prefixAttr = packageElement.attr('prefix');
            if (!prefixAttr || !prefixAttr.includes('schema:')) {
                packageElement.attr('prefix', 'schema: http://schema.org/');
                changes.push('Added schema.org prefix');
            }

            // 4. Remove EPUB 2.0-specific attributes
            this.removeEpub2Attributes($, changes);

            // 5. Update metadata format
            this.updateMetadataFormat($, changes);

            // 6. Check for and create navigation document
            const navResult = this.handleNavigationDocument($, zip, opfPath);
            if (navResult.created) {
                navigationDocument = navResult.content;
                changes.push('Navigation document will be created');
            }
            if (navResult.manifestUpdated) {
                changes.push('Updated manifest with navigation document reference');
            }

            // 7. Update spine and manifest for EPUB 3.0 compatibility
            this.updateSpineAndManifest($, changes, warnings);

            // 8. Fix content files (DOCTYPE, etc.)
            await this.fixContentFiles(zip, changes, warnings);

            return {
                opfContent: $.html(),
                changes,
                warnings,
                errors,
                navigationDocument
            };

        } catch (error) {
            errors.push(`Conversion processing failed: ${error}`);
            return { opfContent, changes, warnings, errors };
        }
    }

    /**
     * Remove EPUB 2.0-specific attributes
     */
    private removeEpub2Attributes($: any, changes: string[]): void {
        // Remove opf:file-as attributes
        $('[opf\\:file-as]').each((_, element) => {
            const $element = $(element);
            $element.removeAttr('opf:file-as');
        });

        // Remove opf:scheme attributes
        $('[opf\\:scheme]').each((_, element) => {
            const $element = $(element);
            $element.removeAttr('opf:scheme');
        });

        // Remove opf:event attributes  
        $('[opf\\:event]').each((_, element) => {
            const $element = $(element);
            $element.removeAttr('opf:event');
        });

        changes.push('Removed EPUB 2.0-specific attributes');
    }

    /**
     * Update metadata format for EPUB 3.0
     */
    private updateMetadataFormat($: any, changes: string[]): void {
        const metadata = $('metadata');

        // Ensure Dublin Core namespace is properly declared
        if (!metadata.attr('xmlns:dc')) {
            metadata.attr('xmlns:dc', 'http://purl.org/dc/elements/1.1/');
            changes.push('Added Dublin Core namespace');
        }

        // Remove xsi:type attributes from dc:language elements
        $('dc\\:language[xsi\\:type]').each((_, element) => {
            const $element = $(element);
            $element.removeAttr('xsi:type');
        });
        changes.push('Removed xsi:type attributes from dc:language elements');

        // Remove all dc:date elements for EPUB 3.0 compliance
        const dateElements = $('dc\\:date');
        if (dateElements.length > 0) {
            dateElements.remove();
            changes.push('Removed dc:date elements for EPUB 3.0 compliance');
        }

        // Fix dcterms:modified format
        $('meta[property="dcterms:modified"]').each((_, element) => {
            const $element = $(element);
            const text = $element.text().trim();
            
            // Convert to proper ISO 8601 format if needed
            if (text) {
                // Try to parse and reformat
                try {
                    const date = new Date(text);
                    if (!isNaN(date.getTime())) {
                        const isoString = date.toISOString().replace(/\.\d+Z$/, 'Z');
                        $element.text(isoString);
                        changes.push(`Fixed dcterms:modified format: ${text} → ${isoString}`);
                    }
                } catch (e) {
                    // If we can't parse it, remove the element and create a new one
                    $element.remove();
                }
            }
        });

        // Add basic EPUB 3.0 metadata if missing
        if (!$('meta[property="dcterms:modified"]').length) {
            const modifiedDate = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
            // Use proper DOM manipulation instead of string concatenation
            const metaElement = $('<meta>').attr('property', 'dcterms:modified').text(modifiedDate);
            metadata.append('\n    ').append(metaElement);
            changes.push('Added dcterms:modified metadata');
        }

        // Manually reorder metadata elements to ensure proper EPUB 3.0 structure
        // Required order: dc:title, dc:language, dc:identifier, then other elements
        const xmlContent = metadata.html();
        
        // Extract all metadata elements
        const elements: Array<{tag: string, content: string, attributes: string}> = [];
        const elementRegex = /<([^>\s]+)([^>]*)>([^<]*(?:<[^>]*>[^<]*)*)<\/\1>/g;
        let match;
        
        while ((match = elementRegex.exec(xmlContent)) !== null) {
            elements.push({
                tag: match[1],
                attributes: match[2],
                content: match[3]
            });
        }
        
        // Sort elements: title, language, identifier first, then others
        const sortedElements = [
            ...elements.filter(e => e.tag === 'dc:title'),
            ...elements.filter(e => e.tag === 'dc:language'),
            ...elements.filter(e => e.tag === 'dc:identifier'),
            ...elements.filter(e => e.tag !== 'dc:title' && e.tag !== 'dc:language' && e.tag !== 'dc:identifier')
        ];
        
        // Rebuild metadata content
        let newContent = '';
        sortedElements.forEach(element => {
            newContent += `<${element.tag}${element.attributes}>${element.content}</${element.tag}>\n    `;
        });
        
        // Update metadata content
        metadata.html('\n    ' + newContent.trim());
        changes.push('Reordered metadata elements for EPUB 3.0 compliance');
    }

    /**
     * Handle navigation document creation and manifest updates
     */
    private handleNavigationDocument($: any, zip: any, opfPath: string): {
        created: boolean;
        content?: string;
        manifestUpdated: boolean;
    } {
        const manifest = $('manifest');

        // Check if navigation document already exists
        const existingNav = manifest.find('item[properties*="nav"]');
        if (existingNav.length > 0) {
            return { created: false, manifestUpdated: false };
        }

        // Create navigation document
        const navPath = this.getNavigationPath(opfPath);
        const navId = 'nav';

        // Add to manifest using proper DOM manipulation
        const navItem = $('<item>')
            .attr('id', navId)
            .attr('href', path.basename(navPath))
            .attr('media-type', 'application/xhtml+xml')
            .attr('properties', 'nav');
        manifest.append('\n    ').append(navItem);

        // Create enhanced navigation content with proper spine references
        const title = $('dc\\:title, title').first().text() || 'Untitled';
        const navContent = this.createEnhancedNavigationDocument($, title);

        return {
            created: true,
            content: navContent,
            manifestUpdated: true
        };
    }

    /**
     * Update spine and manifest for EPUB 3.0
     */
    private updateSpineAndManifest($: any, changes: string[], warnings: string[]): void {
        const spine = $('spine');

        // Remove EPUB 2.0 NCX reference if present
        if (spine.attr('toc')) {
            spine.removeAttr('toc');
            changes.push('Removed NCX toc reference from spine');
        }

        // Check for NCX file in manifest and remove it for EPUB 3.0
        const ncxItem = $('manifest item[media-type="application/x-dtbncx+xml"]');
        if (ncxItem.length > 0) {
            ncxItem.remove();
            changes.push('Removed NCX file from manifest (deprecated in EPUB 3.0)');
            
            // Also remove any reference to NCX in guide
            $('guide reference[type="toc"]').remove();
            changes.push('Removed NCX reference from guide');
        }
    }

    /**
     * Fix content files for EPUB 3.0 compatibility
     */
    private async fixContentFiles(zip: any, changes: string[], warnings: string[]): Promise<void> {
        const filesToProcess: string[] = [];
        
        // Find all XHTML/HTML files (including .htm.html extensions)
        zip.forEach((relativePath: string, file: any) => {
            if (relativePath.match(/\.(xhtml|html|htm)$/i) && !file.dir) {
                filesToProcess.push(relativePath);
            }
            // Also catch files with compound extensions like .htm.html
            if (relativePath.includes('.htm') && !file.dir) {
                if (!filesToProcess.includes(relativePath)) {
                    filesToProcess.push(relativePath);
                }
            }
        });

        this.logger.info(`Found ${filesToProcess.length} content files to process: ${filesToProcess.join(', ')}`);

        for (const filePath of filesToProcess) {
            try {
                const file = zip.file(filePath);
                if (file) {
                    let content = await file.async('string');
                    let modified = false;
                    
                    // Log original DOCTYPE for debugging
                    const doctypeMatch = content.match(/<\!DOCTYPE[^>]*>/i);
                    if (doctypeMatch) {
                        this.logger.info(`Found DOCTYPE in ${filePath}: ${doctypeMatch[0]}`);
                    }

                    // Fix DOCTYPE declarations - handle all XHTML DOCTYPE variations
                    const originalContent = content;
                    
                    // More comprehensive DOCTYPE replacement - catch any DOCTYPE that isn't HTML5
                    const html5Doctype = '<!DOCTYPE html>';
                    
                    // Replace any DOCTYPE that isn't already HTML5
                    content = content.replace(
                        /<\!DOCTYPE\s+[^>]+>/gi,
                        (match) => {
                            if (match.toLowerCase().trim() === '<!doctype html>') {
                                return match; // Already HTML5, keep as-is
                            }
                            this.logger.info(`Replacing DOCTYPE "${match}" with "${html5Doctype}" in ${filePath}`);
                            return html5Doctype;
                        }
                    );
                    
                    if (content !== originalContent) {
                        modified = true;
                        this.logger.info(`Fixed DOCTYPE in ${filePath}`);
                    }

                    // Fix invalid http-equiv values in meta tags
                    const validHttpEquivValues = [
                        'content-security-policy',
                        'content-type',
                        'default-style',
                        'refresh',
                        'x-ua-compatible'
                    ];
                    
                    // Replace invalid http-equiv values with valid ones or remove them
                    content = content.replace(
                        /<meta([^>]*)http-equiv\s*=\s*["']([^"']*)["']([^>]*)>/gi,
                        (match, before, value, after) => {
                            const lowerValue = value.toLowerCase();
                            if (validHttpEquivValues.includes(lowerValue)) {
                                return match; // Keep valid values
                            } else {
                                // Remove the entire meta tag if it's invalid
                                return '';
                            }
                        }
                    );

                    // Ensure proper XML declaration for XHTML files
                    if (filePath.endsWith('.xhtml') && !content.startsWith('<?xml')) {
                        content = '<?xml version="1.0" encoding="UTF-8"?>\n' + content;
                        modified = true;
                    }

                    if (modified) {
                        zip.file(filePath, content);
                        changes.push(`Fixed DOCTYPE and XML declaration in ${filePath}`);
                    }
                }
            } catch (error) {
                warnings.push(`Could not process content file ${filePath}: ${error}`);
            }
        }
    }

    /**
     * Create enhanced navigation document content with proper spine references
     */
    private createEnhancedNavigationDocument($: any, title: string): string {
        // Get spine items to build proper TOC
        const spineItems: Array<{id: string, href: string}> = [];
        
        $('spine itemref').each((_, element) => {
            const idref = $(element).attr('idref');
            if (idref) {
                const manifestItem = $(`manifest item[id="${idref}"]`);
                const href = manifestItem.attr('href');
                if (href) {
                    spineItems.push({ id: idref, href });
                }
            }
        });

        // Build TOC entries from spine
        let tocEntries = '';
        if (spineItems.length > 0) {
            spineItems.forEach((item, index) => {
                const displayName = item.href.replace(/\.(xhtml|html)$/, '').replace(/^.*\//, '');
                tocEntries += `\n            <li><a href="${item.href}">Chapter ${index + 1}: ${displayName}</a></li>`;
            });
        } else {
            tocEntries = '\n            <li><a href="content.xhtml">Content</a></li>';
        }

        // Build landmarks with first spine item as bodymatter
        const firstSpineHref = spineItems.length > 0 ? spineItems[0].href : 'content.xhtml';

        // Create navigation document with proper role attributes that are valid in EPUB
        return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
    <title>${title} - Navigation</title>
    <meta charset="utf-8"/>
</head>
<body>
    <nav epub:type="toc" id="toc" role="doc-toc">
        <h1>Table of Contents</h1>
        <ol>${tocEntries}
        </ol>
    </nav>
    <nav epub:type="landmarks" id="landmarks" role="navigation" hidden="">
        <h1>Landmarks</h1>
        <ol>
            <li><a href="${firstSpineHref}" epub:type="bodymatter" role="doc-biblioref">Content</a></li>
        </ol>
    </nav>
</body>
</html>`;
    }

    /**
     * Get navigation file path relative to OPF
     */
    private getNavigationPath(opfPath: string): string {
        const opfDir = path.dirname(opfPath);
        return opfDir ? `${opfDir}/nav.xhtml` : 'nav.xhtml';
    }

    /**
     * Extract OPF path from container.xml
     */
    private extractOpfPath(containerXml: string): string | null {
        const match = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/);
        return match ? match[1] : null;
    }
}