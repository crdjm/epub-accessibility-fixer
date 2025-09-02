import { ValidationIssue, FixResult, ProcessingContext, EpubContent, ManifestItem, SpineItem } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';
import * as path from 'path';

type Cheerio = any;
type CheerioStatic = any;

export class NonLinearContentFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Non-Linear Content Fixer';
    }

    getHandledCodes(): string[] {
        return ['non-linear-content-reachable', 'OPF-096'];
    }

    canFix(issue: ValidationIssue): boolean {
        // Log for debugging
        this.logger.info(`NonLinearContentFixer checking issue: code="${issue.code}", message="${issue.message}"`);
        
        // More comprehensive matching for non-linear content reachability issues
        const codeMatch = this.getHandledCodes().includes(issue.code);
        
        const messageMatch = issue.message.toLowerCase().includes('non-linear content') && 
                           issue.message.toLowerCase().includes('must be reachable') &&
                          (issue.message.toLowerCase().includes('found no hyperlink') ||
                           issue.message.toLowerCase().includes('no hyperlink found'));
        
        // Also check for generic non-linear content reachability patterns
        const genericMessageMatch = issue.message.toLowerCase().includes('non-linear content') && 
                                   issue.message.toLowerCase().includes('must be reachable');
        
        const canFix = codeMatch || messageMatch || genericMessageMatch;
        this.logger.info(`NonLinearContentFixer can fix issue: ${canFix ? 'yes' : 'no'} (codeMatch: ${codeMatch}, messageMatch: ${messageMatch}, genericMessageMatch: ${genericMessageMatch})`);
        return canFix;
    }

    // Helper method to check if appendix section already exists in content
    private hasExistingAppendixSection(contentString: string): boolean {
        // Check for the exact pattern that we would add
        const appendixPattern = '<section epub:type="appendix" role="doc-appendix">';
        const headingPattern = '<h2>Additional Content</h2>';
        const contentPattern = '<p>The following additional content is available:</p>';
        const listPattern = '<ul>';
        
        // First check with exact string matching (fastest)
        if (contentString.includes(appendixPattern) && 
            contentString.includes(headingPattern) && 
            contentString.includes(contentPattern) && 
            contentString.includes(listPattern)) {
            this.logger.info('Found exact appendix section pattern using string matching');
            return true;
        }
        
        // Also check with a more general pattern using regex
        const generalAppendixPattern = '<section[^>]*epub:type[^>]*appendix[^>]*>';
        const generalHeadingPattern = '<h[1-2][^>]*>\\s*Additional Content\\s*</h[1-2]>';
        const generalContentPattern = 'additional content is available';
        
        const generalAppendixRegex = new RegExp(generalAppendixPattern, 'i');
        const generalHeadingRegex = new RegExp(generalHeadingPattern, 'i');
        const generalContentRegex = new RegExp(generalContentPattern, 'i');
        
        if (generalAppendixRegex.test(contentString) && 
            generalHeadingRegex.test(contentString) && 
            generalContentRegex.test(contentString)) {
            this.logger.info('Found general appendix section pattern using regex matching');
            return true;
        }
        
        // NEW: Check for the exact duplicate pattern that the user is experiencing
        // This is a more robust check that looks for the complete section
        const exactSectionPattern = '<section[^>]*epub:type[^>]*appendix[^>]*role[^>]*doc-appendix[^>]*>\\s*<h2[^>]*>\\s*Additional Content\\s*</h2>\\s*<p[^>]*>\\s*The following additional content is available:\\s*</p>\\s*<ul[^>]*>\\s*<li[^>]*>\\s*<a[^>]*href\\s*=\\s*["\'][^"\']*["\'][^>]*>\\s*[^<]*\\s*</a>\\s*</li>\\s*<li[^>]*>\\s*<a[^>]*href\\s*=\\s*["\'][^"\']*["\'][^>]*>\\s*[^<]*\\s*</a>\\s*</li>\\s*</ul>\\s*</section>';
        const exactSectionRegex = new RegExp(exactSectionPattern, 'gs');
        const sectionMatches = contentString.match(exactSectionRegex);
        
        if (sectionMatches && sectionMatches.length > 0) {
            this.logger.info(`Found ${sectionMatches.length} existing appendix section(s) using robust pattern matching`);
            return true;
        }
        
        return false;
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`Fixing non-linear content reachability: ${issue.message}`);

        try {
            // Find the OPF file
            let opfContent: EpubContent | null = null;
            let opfPath = '';
            
            for (const [filePath, content] of context.contents) {
                if (filePath.endsWith('.opf') || content.mediaType === 'application/oebps-package+xml') {
                    opfContent = content;
                    opfPath = filePath;
                    break;
                }
            }
            
            if (!opfContent) {
                return this.createFixResult(false, 'Could not find OPF file to fix non-linear content');
            }

            // Identify non-linear content items
            const nonLinearItems = this.findNonLinearItems(context);
            this.logger.info(`Found ${nonLinearItems.length} non-linear content items`);

            if (nonLinearItems.length === 0) {
                return this.createFixResult(false, 'No non-linear content items found');
            }

            // Add links to non-linear content in appropriate places
            const changedFiles = await this.addLinksToNonLinearContent(nonLinearItems, context);
            
            if (changedFiles.length > 0) {
                return this.createFixResult(
                    true,
                    `Added links to make ${nonLinearItems.length} non-linear content items reachable`,
                    changedFiles,
                    { itemsLinked: nonLinearItems.length }
                );
            } else {
                // When no files were changed, it could be because:
                // 1. No action was needed (sections already exist) - this is a success
                // 2. Something went wrong - this is a failure
                // We need to distinguish between these cases
                
                // Check if the target file already has the appendix section
                // If it does, then this is a success case (no action needed)
                const targetContent = this.getAllContentFiles(context).find(content => {
                    return context.manifest.spine.some(spineItem => {
                        if (spineItem.linear !== false) {
                            const manifestItem = context.manifest.items.find(item => item.id === spineItem.idref);
                            const normalizedManifestHref = manifestItem.href.replace(/^\/+/, '').replace(/\\/g, '/');
                            const normalizedContentPath = content.path.replace(/^\/+/, '').replace(/\\/g, '/');
                            const manifestFileName = path.basename(manifestItem.href);
                            const contentFileName = path.basename(content.path);
                            return normalizedManifestHref === normalizedContentPath || manifestFileName === contentFileName;
                        }
                        return false;
                    });
                });
                
                if (targetContent) {
                    const contentString = typeof targetContent.content === 'string' ? targetContent.content : targetContent.content.toString();
                    
                    // Use the robust detection method
                    if (this.hasExistingAppendixSection(contentString)) {
                        return this.createFixResult(
                            true,
                            `Non-linear content links already exist, no action needed`,
                            [], // No files were changed
                            { itemsLinked: nonLinearItems.length }
                        );
                    }
                }
                
                // If we get here, it means no files were changed and no existing sections were found
                // This indicates a real failure
                return this.createFixResult(
                    false,
                    'Could not add links to non-linear content items'
                );
            }

        } catch (error) {
            this.logger.error(`Non-linear content fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix non-linear content reachability: ${error}`);
        }
    }

    private findNonLinearItems(context: ProcessingContext): ManifestItem[] {
        const nonLinearItems: ManifestItem[] = [];
        
        // Find items in the spine that are marked as non-linear
        for (const spineItem of context.manifest.spine) {
            if (spineItem.linear === false) {
                // Find the corresponding manifest item
                const manifestItem = context.manifest.items.find(item => item.id === spineItem.idref);
                if (manifestItem) {
                    nonLinearItems.push(manifestItem);
                }
            }
        }
        
        return nonLinearItems;
    }

    private async addLinksToNonLinearContent(nonLinearItems: ManifestItem[], context: ProcessingContext): Promise<string[]> {
        const changedFiles: string[] = [];
        
        // Log all manifest items and content files for debugging
        this.logger.info('Manifest items:');
        context.manifest.items.forEach(item => {
            this.logger.info(`  - id: ${item.id}, href: ${item.href}, mediaType: ${item.mediaType}`);
        });
        
        this.logger.info('Spine items:');
        context.manifest.spine.forEach(spineItem => {
            this.logger.info(`  - idref: ${spineItem.idref}, linear: ${spineItem.linear}`);
        });
        
        this.logger.info('Content files:');
        this.getAllContentFiles(context).forEach(content => {
            this.logger.info(`  - path: ${content.path}, mediaType: ${content.mediaType}`);
        });
        
        // We'll add links to the first linear content file we find
        let linearContentFiles = this.getAllContentFiles(context).filter(content => {
            // Check if this content file is in the linear spine
            return context.manifest.spine.some(spineItem => {
                if (spineItem.linear !== false) { // linear is true or undefined
                    const manifestItem = context.manifest.items.find(item => item.id === spineItem.idref);
                    // Compare paths more flexibly - check if they match when normalized
                    // Try multiple normalization approaches
                    const normalizedManifestHref = manifestItem.href.replace(/^\/+/, '').replace(/\\/g, '/');
                    const normalizedContentPath = content.path.replace(/^\/+/, '').replace(/\\/g, '/');
                    
                    // Also try matching just the filename
                    const manifestFileName = path.basename(manifestItem.href);
                    const contentFileName = path.basename(content.path);
                    
                    this.logger.info(`Comparing manifest href '${manifestItem.href}' with content path '${content.path}'`);
                    this.logger.info(`Normalized paths: '${normalizedManifestHref}' vs '${normalizedContentPath}' - match: ${normalizedManifestHref === normalizedContentPath}`);
                    this.logger.info(`Filename comparison: '${manifestFileName}' vs '${contentFileName}' - match: ${manifestFileName === contentFileName}`);
                    
                    return normalizedManifestHref === normalizedContentPath || manifestFileName === contentFileName;
                }
                return false;
            });
        });
        
        this.logger.info(`Found ${linearContentFiles.length} linear content files`);
        
        if (linearContentFiles.length === 0) {
            // Try a more flexible approach - look for any linear content file regardless of exact path matching
            this.logger.info('Trying flexible approach to find linear content files...');
            
            const allLinearSpineItems = context.manifest.spine.filter(spineItem => spineItem.linear !== false);
            this.logger.info(`Found ${allLinearSpineItems.length} linear spine items`);
            
            for (const spineItem of allLinearSpineItems) {
                const manifestItem = context.manifest.items.find(item => item.id === spineItem.idref);
                if (manifestItem) {
                    this.logger.info(`Looking for content file matching manifest item: ${manifestItem.href}`);
                    const contentFile = this.findContentByPath(context, manifestItem.href);
                    if (contentFile) {
                        // Check if we already have this file to avoid duplicates
                        if (!linearContentFiles.some(file => file.path === contentFile.path)) {
                            linearContentFiles.push(contentFile);
                            this.logger.info(`Found content file for ${manifestItem.href}: ${contentFile.path}`);
                        }
                    } else {
                        this.logger.info(`No content file found for manifest item: ${manifestItem.href}`);
                    }
                }
            }
            
            this.logger.info(`After flexible approach, found ${linearContentFiles.length} linear content files`);
        }
        
        // If still no linear content files found, try to find any XHTML content file as fallback
        if (linearContentFiles.length === 0) {
            this.logger.info('Trying fallback approach - using any XHTML content file...');
            const allXhtmlFiles = this.getAllContentFiles(context);
            if (allXhtmlFiles.length > 0) {
                linearContentFiles = [allXhtmlFiles[0]];
                this.logger.info(`Using fallback file: ${linearContentFiles[0].path}`);
            }
        }
        
        if (linearContentFiles.length === 0) {
            this.logger.warn('No linear content files found to add links to non-linear content');
            return changedFiles;
        }
        
        // Use the first linear content file (typically the first chapter or main content)
        const targetContent = linearContentFiles[0];
        this.logger.info(`Adding links to non-linear content in ${targetContent.path}`);
        
        const $ = this.loadDocument(targetContent);
        
        // DEBUG: Log the content before checking for existing sections
        const contentString = typeof targetContent.content === 'string' ? targetContent.content : targetContent.content.toString();
        this.logger.info(`Content before checking for existing appendix sections: ${contentString.substring(0, 500)}...`);
        
        // Use the robust detection method
        if (this.hasExistingAppendixSection(contentString)) {
            this.logger.info(`Found existing appendix section, skipping addition to prevent duplication`);
            // Return success with a message indicating no action was needed
            return changedFiles;
        }
        
        // Find a suitable place to add the links - look for the end of the document or after the last heading
        let insertionPoint: Cheerio = $('body').first();
        
        // Look for a logical place to insert - after the main content but before any footnotes or end matter
        const possibleInsertionPoints = [
            'section[epub\\:type*="conclusion"]',
            'section[epub\\:type*="afterword"]',
            'section[epub\\:type*="appendix"]',
            'div[epub\\:type*="conclusion"]',
            'div[epub\\:type*="afterword"]',
            'div[epub\\:type*="appendix"]'
        ];
        
        let foundInsertionPoint = false;
        for (const selector of possibleInsertionPoints) {
            const element = $(selector).last();
            if (element.length > 0) {
                insertionPoint = element;
                foundInsertionPoint = true;
                this.logger.info(`Found insertion point: ${selector}`);
                break;
            }
        }
        
        // If we didn't find a specific insertion point, add to the end of the body
        if (!foundInsertionPoint) {
            insertionPoint = $('body').first();
            this.logger.info('Using body as insertion point');
        }
        
        // Create a section for the non-linear content links
        let linksAdded = 0;
        let linkSection = '<section epub:type="appendix" role="doc-appendix">\n';
        linkSection += '    <h2>Additional Content</h2>\n';
        linkSection += '    <p>The following additional content is available:</p>\n';
        linkSection += '    <ul>\n';
        
        for (const item of nonLinearItems) {
            // Generate a user-friendly name from the href
            const fileName = path.basename(item.href, path.extname(item.href));
            const displayName = fileName
                .replace(/[-_]/g, ' ')
                .replace(/\b\w/g, l => l.toUpperCase());
            
            this.logger.info(`Adding link to non-linear item: ${item.href} (${displayName})`);
            linkSection += `        <li><a href="${item.href}">${displayName}</a></li>\n`;
            linksAdded++;
        }
        
        linkSection += '    </ul>\n';
        linkSection += '</section>\n';
        
        // DEBUG: Log the section we're about to add
        this.logger.info(`About to add appendix section: ${linkSection}`);
        
        // Insert the link section
        if (foundInsertionPoint) {
            insertionPoint.after(linkSection);
        } else {
            // Add to end of body
            $('body').append('\n' + linkSection);
        }
        
        if (linksAdded > 0) {
            this.saveDocument($, targetContent);
            changedFiles.push(targetContent.path);
            this.logger.info(`Added links to ${linksAdded} non-linear content items in ${targetContent.path}`);
        } else {
            this.logger.warn('No links were added to non-linear content');
        }
        
        return changedFiles;
    }
}