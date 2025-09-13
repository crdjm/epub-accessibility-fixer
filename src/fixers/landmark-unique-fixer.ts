import { ValidationIssue, FixResult, ProcessingContext, EpubContent, FixDetail } from '../types';
import { BaseFixer } from './base-fixer';
import { Logger } from '../utils/common';

type CheerioStatic = any;
type CheerioElement = any;

export class LandmarkUniqueFixer extends BaseFixer {
    constructor(logger: Logger) {
        super(logger);
    }

    getFixerName(): string {
        return 'Landmark Unique Fixer';
    }

    getHandledCodes(): string[] {
        return [
            'landmark-unique',
            'Landmarks should have a unique role or role/label/title',
            'The landmark must have a unique aria-label, aria-labelledby, or title',
            'landmark-no-duplicate-banner', // Add specific code for duplicate banner issues
            'duplicate banner' // Add pattern for duplicate banner messages
        ];
    }

    canFix(issue: ValidationIssue): boolean {
        // Check handled codes
        const codesMatch = this.getHandledCodes().some(code =>
            issue.code.includes(code) ||
            code.includes(issue.code) ||
            issue.message.includes(code)
        );

        if (codesMatch) {
            this.logger.info(`LandmarkUniqueFixer can fix issue with code match: ${issue.code}`);
            return true;
        }

        // Also check if the message contains the specific patterns we handle
        const messagePatterns = [
            'Landmarks should have a unique role or role/label/title',
            'The landmark must have a unique aria-label, aria-labelledby, or title',
            'landmark must have a unique',
            'Ensure landmarks are unique',
            'landmark-unique',  // DAISY ACE specific pattern
            'Document has more than one banner landmark', // Specific pattern for duplicate banner
            'duplicate banner', // General pattern for duplicate banner
            'more than one banner' // Another pattern for duplicate banner
        ];

        const matchesPattern = messagePatterns.some(pattern =>
            issue.message.toLowerCase().includes(pattern.toLowerCase())
        );
        
        this.logger.info(`LandmarkUniqueFixer checking issue: code="${issue.code}", message="${issue.message.substring(0, 100)}..."`);
        this.logger.info(`LandmarkUniqueFixer pattern match result: ${matchesPattern}`);
        
        // Special handling for DAISY ACE landmark issues
        const isDaisyAceLandmarkIssue = issue.code.includes('landmark-unique') || 
                                       (issue.message.includes('landmark') && issue.message.includes('unique')) ||
                                       issue.code === 'landmark-unique';

        // Special handling for duplicate banner issues
        const isDuplicateBannerIssue = issue.code.includes('landmark-no-duplicate-banner') ||
                                      issue.message.includes('banner landmark') ||
                                      issue.message.includes('duplicate banner');

        if (matchesPattern || isDaisyAceLandmarkIssue || isDuplicateBannerIssue) {
            this.logger.info(`LandmarkUniqueFixer can fix issue with pattern match: ${issue.message.substring(0, 100)}...`);
            return true;
        }

        this.logger.info(`LandmarkUniqueFixer cannot fix issue: ${issue.code} - ${issue.message.substring(0, 100)}...`);
        return false;
    }

    async fix(issue: ValidationIssue, context: ProcessingContext): Promise<FixResult> {
        this.logger.info(`LandmarkUniqueFixer: Fixing landmark unique issue: ${issue.message}`);
        this.logger.info(`LandmarkUniqueFixer: Issue location: ${issue.location?.file || 'global'}`);
        this.logger.info(`LandmarkUniqueFixer: Issue code: ${issue.code}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                this.logger.info(`LandmarkUniqueFixer: Processing specific file: ${issue.location.file}`);
                const content = this.findContentByPath(context, issue.location.file);

                if (content) {
                    this.logger.info(`LandmarkUniqueFixer: Found content for file: ${content.path}`);
                    const fixed = await this.fixLandmarkUniquenessInFile(content, context, issue);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                        this.logger.info(`LandmarkUniqueFixer: Fixed ${fixed} landmark uniqueness issues in ${content.path}`);
                    } else {
                        this.logger.info(`LandmarkUniqueFixer: No landmark uniqueness issues fixed in ${content.path}`);
                    }
                } else {
                    this.logger.warn(`LandmarkUniqueFixer: Could not find content for file: ${issue.location.file}`);
                    // List available files for debugging
                    this.logger.info('LandmarkUniqueFixer: Available files:');
                    for (const [path] of context.contents) {
                        this.logger.info(`LandmarkUniqueFixer:   - ${path}`);
                    }
                    
                    // Try to process all files as a fallback
                    this.logger.info('LandmarkUniqueFixer: Processing all content files as fallback');
                    const contentFiles = this.getAllContentFiles(context);
                    this.logger.info(`LandmarkUniqueFixer: Found ${contentFiles.length} content files to check`);

                    for (const content of contentFiles) {
                        const fixed = await this.fixLandmarkUniquenessInFile(content, context, issue);
                        if (fixed > 0) {
                            changedFiles.push(content.path);
                            totalFixed += fixed;
                            this.logger.info(`LandmarkUniqueFixer: Fixed ${fixed} landmark uniqueness issues in ${content.path}`);
                        }
                    }
                }
            } else {
                // Fix all content files that might have landmark issues
                this.logger.info('LandmarkUniqueFixer: Processing all content files for landmark issues');
                const contentFiles = this.getAllContentFiles(context);
                this.logger.info(`LandmarkUniqueFixer: Found ${contentFiles.length} content files to check`);

                for (const content of contentFiles) {
                    const fixed = await this.fixLandmarkUniquenessInFile(content, context, issue);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                        this.logger.info(`LandmarkUniqueFixer: Fixed ${fixed} landmark uniqueness issues in ${content.path}`);
                    }
                }
            }

            if (totalFixed > 0) {
                this.logger.info(`LandmarkUniqueFixer: Successfully fixed ${totalFixed} landmark issues`);
                return this.createFixResult(
                    true,
                    `Made ${totalFixed} landmarks unique by adding accessible names`,
                    changedFiles,
                    { landmarksFixed: totalFixed }
                );
            } else {
                // Special handling for duplicate banner issues
                if (issue.message.includes('banner') && issue.message.includes('duplicate')) {
                    this.logger.info('LandmarkUniqueFixer: Attempting to fix duplicate banner issue specifically');
                    const result = await this.fixDuplicateBannerIssue(context);
                    if (result.success) {
                        this.logger.info('LandmarkUniqueFixer: Successfully fixed duplicate banner issue');
                        return result;
                    } else {
                        this.logger.info('LandmarkUniqueFixer: Failed to fix duplicate banner issue');
                    }
                }
                
                // Even if we couldn't fix specific elements, try a more general approach
                this.logger.info('LandmarkUniqueFixer: Attempting general landmark fix');
                const generalResult = await this.fixAllLandmarks(context);
                if (generalResult.success) {
                    this.logger.info('LandmarkUniqueFixer: Successfully fixed landmarks with general approach');
                    return generalResult;
                }
                
                this.logger.info('LandmarkUniqueFixer: No landmark uniqueness issues found to fix');
                return this.createFixResult(
                    false,
                    'No landmark uniqueness issues found to fix'
                );
            }

        } catch (error) {
            this.logger.error(`LandmarkUniqueFixer: Landmark unique fix failed: ${error}`);
            return this.createFixResult(false, `Failed to fix landmark uniqueness: ${error}`);
        }
    }

    private async fixLandmarkUniquenessInFile(content: EpubContent, context: ProcessingContext, issue: ValidationIssue): Promise<number> {
        this.logger.info(`Fixing landmark uniqueness in file: ${content.path}`);
        
        const $ = this.loadDocument(content);
        let fixedCount = 0;

        // Find all elements that could be landmarks using more comprehensive selectors
        const potentialLandmarks: any[] = [];
        
        // Find elements with epub:type attribute
        $('[epub\\:type]').each((_: number, element: CheerioElement) => {
            const $element = $(element);
            const epubType = $element.attr('epub:type') || '';
            potentialLandmarks.push(element);
            this.logger.info(`Found element with epub:type="${epubType}"`);
        });
        
        // Find elements with role attributes
        $('[role]').each((_: number, element: CheerioElement) => {
            const $element = $(element);
            const role = $element.attr('role') || '';
            potentialLandmarks.push(element);
            this.logger.info(`Found element with role="${role}"`);
        });
        
        // Also add nav elements specifically
        $('nav').each((_: number, element: CheerioElement) => {
            potentialLandmarks.push(element);
            this.logger.info(`Found nav element`);
        });
        
        // Remove duplicates by creating a Set of unique elements
        const uniqueLandmarks = Array.from(new Set(potentialLandmarks.map(e => e)));
        
        this.logger.info(`Found ${uniqueLandmarks.length} potential landmark elements`);

        // Even if we didn't find potential landmarks, let's do a more general search
        // Look for any element that might be a landmark
        this.logger.info('Doing general search for landmark elements');
        
        // Track landmark types to ensure uniqueness
        const landmarkTypes: { [key: string]: number } = {};
        
        // More comprehensive selector to find landmark elements
        const landmarkSelectors = [
            '[epub\\:type]',
            '[role]', 
            'nav', 
            'aside', 
            'header', 
            'footer', 
            'main', 
            'section'
        ].join(', ');
        
        this.logger.info(`Using landmark selectors: ${landmarkSelectors}`);
        
        $(landmarkSelectors).each((_: number, element: CheerioElement) => {
            const $element = $(element);
            const epubType = $element.attr('epub:type') || '';
            const role = $element.attr('role') || '';
            const tagName = $element.prop('tagName')?.toLowerCase() || '';
            const ariaLabel = $element.attr('aria-label') || '';
            const title = $element.attr('title') || '';
            const ariaLabelledBy = $element.attr('aria-labelledby') || '';
            const className = $element.attr('class') || '';
            
            // Check if this element is likely to be a landmark
            const isLandmark = epubType || role || 
                              ['nav', 'aside', 'header', 'footer', 'main', 'section'].includes(tagName);
            
            this.logger.info(`Checking element: epub:type="${epubType}", role="${role}", tagName="${tagName}", isLandmark=${isLandmark}`);
            
            if (isLandmark) {
                // Check if this element lacks a unique name
                if (!ariaLabel && !title && !ariaLabelledBy) {
                    this.logger.info(`Found landmark element without unique name: epub:type="${epubType}", role="${role}", tagName="${tagName}"`);
                    
                    // Generate a unique name based on the element type
                    let baseName = '';
                    if (epubType) {
                        baseName = epubType.replace(/-/g, ' ');
                    } else if (role) {
                        baseName = role.replace('doc-', '').replace(/-/g, ' ');
                    } else if (tagName) {
                        baseName = tagName;
                    } else if (className) {
                        // Use class name if available
                        baseName = className.split(' ')[0].replace(/-/g, ' ');
                    }
                    
                    if (baseName) {
                        // Capitalize first letter of each word
                        const capitalizedBaseName = baseName.replace(/\b\w/g, l => l.toUpperCase());
                        
                        // Track how many of this type we've seen
                        if (!landmarkTypes[baseName]) {
                            landmarkTypes[baseName] = 1;
                        } else {
                            landmarkTypes[baseName]++;
                        }
                        
                        // Create unique name with counter if needed
                        let uniqueName = capitalizedBaseName;
                        if (landmarkTypes[baseName] > 1) {
                            uniqueName = `${capitalizedBaseName} ${landmarkTypes[baseName]}`;
                        }
                        
                        $element.attr('aria-label', uniqueName);
                        fixedCount++;
                        this.logger.info(`Added aria-label="${uniqueName}" to element with epub:type="${epubType}" role="${role}" tagName="${tagName}" class="${className}"`);
                    }
                } else {
                    this.logger.info(`Landmark element already has unique name: aria-label="${ariaLabel}", title="${title}", aria-labelledby="${ariaLabelledBy}"`);
                }
            }
        });

        if (fixedCount > 0) {
            this.logger.info(`Saving document with ${fixedCount} fixed landmark uniqueness issues`);
            this.saveDocument($, content);
        }

        return fixedCount;
    }

    /**
     * Special fix for duplicate banner landmark issues
     */
    private async fixDuplicateBannerIssue(context: ProcessingContext): Promise<FixResult> {
        this.logger.info('Fixing duplicate banner landmark issue');
        
        const changedFiles: string[] = [];
        let totalFixed = 0;
        const fixDetails: FixDetail[] = [];

        // Find all content files - use a more comprehensive approach
        const contentFiles = this.getAllContentFiles(context);
        this.logger.info(`Found ${contentFiles.length} content files to check for banner landmarks`);
        
        // If no content files found, try to get all text-based files from context
        if (contentFiles.length === 0) {
            this.logger.info('No XHTML/HTML files found, checking all text content files');
            for (const [path, content] of context.contents) {
                if (typeof content.content === 'string' && (path.endsWith('.xhtml') || path.endsWith('.html') || path.includes('.xhtml') || path.includes('.html'))) {
                    contentFiles.push(content);
                    this.logger.info(`Added file to check: ${path}`);
                }
            }
        }
        
        // Track banner landmarks across all files
        const bannerLandmarks: Array<{content: EpubContent, $: CheerioStatic, element: any, $element: any}> = [];
        
        // First pass: collect all banner landmarks with more flexible selectors
        for (const content of contentFiles) {
            try {
                const $ = this.loadDocument(content);
                
                // Find elements that are banner landmarks with more flexible selectors
                // Look for elements with role containing "banner" or epub:type containing "banner"
                const bannerElements = $('[role*="banner"], [epub\\:type*="banner"], [role="banner"], [epub\\:type="banner"]').toArray();
                
                this.logger.info(`Found ${bannerElements.length} potential banner elements in ${content.path}`);
                
                for (const element of bannerElements) {
                    const $element = $(element);
                    const role = $element.attr('role') || '';
                    const epubType = $element.attr('epub:type') || '';
                    this.logger.info(`Found banner element: role="${role}", epub:type="${epubType}"`);
                    bannerLandmarks.push({
                        content,
                        $,
                        element,
                        $element
                    });
                }
            } catch (error) {
                this.logger.warn(`Could not process file ${content.path} for banner landmarks: ${error}`);
            }
        }
        
        this.logger.info(`Found ${bannerLandmarks.length} banner landmarks across all files`);
        
        // If we have more than one banner landmark, we need to fix duplicates
        if (bannerLandmarks.length > 1) {
            this.logger.info(`Processing ${bannerLandmarks.length} banner landmarks, keeping first one`);
            // Keep the first banner landmark, make others non-banner landmarks
            for (let i = 1; i < bannerLandmarks.length; i++) {
                const {content, $, element, $element} = bannerLandmarks[i];
                
                // Change the role from "banner" to something else or remove it
                const originalRole = $element.attr('role');
                const originalEpubType = $element.attr('epub:type');
                const originalHtml = $.html($element);
                
                this.logger.info(`Processing banner landmark ${i}: role="${originalRole}", epub:type="${originalEpubType}"`);
                
                // Remove banner role
                if (originalRole) {
                    if (originalRole.includes('banner')) {
                        // If role is exactly "banner" or contains "banner", remove or replace it
                        if (originalRole === 'banner') {
                            $element.removeAttr('role');
                            this.logger.info('Removed role="banner" attribute');
                        } else {
                            // For roles like "doc-banner", replace with a more appropriate role
                            const newRole = originalRole.replace(/banner/g, 'contentinfo');
                            $element.attr('role', newRole);
                            this.logger.info(`Replaced role="${originalRole}" with role="${newRole}"`);
                        }
                    }
                }
                
                // Remove banner epub:type
                if (originalEpubType) {
                    if (originalEpubType.includes('banner')) {
                        if (originalEpubType === 'banner') {
                            $element.removeAttr('epub:type');
                            this.logger.info('Removed epub:type="banner" attribute');
                        } else {
                            // For epub:types like "doc-banner", replace with a more appropriate type
                            const newEpubType = originalEpubType.replace(/banner/g, 'contentinfo');
                            $element.attr('epub:type', newEpubType);
                            this.logger.info(`Replaced epub:type="${originalEpubType}" with epub:type="${newEpubType}"`);
                        }
                    }
                }
                
                // Add a more appropriate role if needed and if element doesn't already have one
                const tagName = $element.prop('tagName')?.toLowerCase();
                const currentRole = $element.attr('role');
                if (tagName === 'header' && !currentRole) {
                    // Headers can be given a banner role, but if we already have one,
                    // we should use a different role or just add an aria-label
                    $element.attr('role', 'contentinfo'); // Or another appropriate role
                    this.logger.info('Added role="contentinfo" to header element');
                }
                
                // Ensure the element still has an accessible name
                if (!$element.attr('aria-label') && !$element.attr('aria-labelledby') && !$element.attr('title')) {
                    $element.attr('aria-label', 'Page Header'); // Generic label
                    this.logger.info('Added aria-label="Page Header" to ensure accessible name');
                }
                
                const fixedHtml = $.html($element);
                fixDetails.push({
                    filePath: content.path,
                    originalContent: originalHtml,
                    fixedContent: fixedHtml,
                    explanation: `Changed duplicate banner landmark to contentinfo role to avoid duplication`,
                    element: tagName || 'element',
                    attribute: 'role',
                    oldValue: originalRole || originalEpubType,
                    newValue: $element.attr('role') || $element.attr('epub:type') || 'aria-label'
                });
                
                // Save the document
                this.saveDocument($, content);
                changedFiles.push(content.path);
                totalFixed++;
                
                this.logger.info(`Fixed duplicate banner landmark in ${content.path}`);
            }
            
            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Fixed ${totalFixed} duplicate banner landmarks by changing their roles`,
                    changedFiles,
                    { landmarksFixed: totalFixed, fixDetails }
                );
            }
        } else {
            this.logger.info('No duplicate banner landmarks found to fix');
            
            // Even if we don't have duplicates, we should still try to fix any banner landmarks
            // that don't have accessible names
            let fixedAny = false;
            for (const {content, $, element, $element} of bannerLandmarks) {
                const ariaLabel = $element.attr('aria-label');
                const title = $element.attr('title');
                const ariaLabelledBy = $element.attr('aria-labelledby');
                
                // If banner landmark lacks accessible name, add one
                if (!ariaLabel && !title && !ariaLabelledBy) {
                    $element.attr('aria-label', 'Page Header');
                    this.saveDocument($, content);
                    changedFiles.push(content.path);
                    fixedAny = true;
                    this.logger.info(`Added accessible name to banner landmark in ${content.path}`);
                }
            }
            
            if (fixedAny) {
                return this.createFixResult(
                    true,
                    `Added accessible names to banner landmarks`,
                    changedFiles,
                    { landmarksFixed: changedFiles.length, fixDetails }
                );
            }
        }
        
        return this.createFixResult(
            false,
            'No duplicate banner landmarks found to fix'
        );
    }

    /**
     * General fix for all landmark issues
     */
    private async fixAllLandmarks(context: ProcessingContext): Promise<FixResult> {
        this.logger.info('Fixing all landmark issues');
        
        const changedFiles: string[] = [];
        let totalFixed = 0;
        const fixDetails: FixDetail[] = [];

        // Get all content files with a more comprehensive approach
        let contentFiles = this.getAllContentFiles(context);
        
        // If no content files found, try to get all text-based files from context
        if (contentFiles.length === 0) {
            this.logger.info('No XHTML/HTML files found, checking all text content files');
            for (const [path, content] of context.contents) {
                if (typeof content.content === 'string' && (path.endsWith('.xhtml') || path.endsWith('.html') || path.includes('.xhtml') || path.includes('.html'))) {
                    contentFiles.push(content);
                    this.logger.info(`Added file to check: ${path}`);
                }
            }
        }
        
        this.logger.info(`Found ${contentFiles.length} content files to check for all landmarks`);

        // Process all content files
        for (const content of contentFiles) {
            try {
                const $ = this.loadDocument(content);
                let fileFixedCount = 0;
                
                // Find all potential landmark elements
                const landmarkSelectors = [
                    '[epub\\:type]',
                    '[role]', 
                    'nav', 
                    'aside', 
                    'header', 
                    'footer', 
                    'main', 
                    'section'
                ].join(', ');
                
                $(landmarkSelectors).each((_: number, element: CheerioElement) => {
                    const $element = $(element);
                    const epubType = $element.attr('epub:type') || '';
                    const role = $element.attr('role') || '';
                    const tagName = $element.prop('tagName')?.toLowerCase() || '';
                    const ariaLabel = $element.attr('aria-label') || '';
                    const title = $element.attr('title') || '';
                    const ariaLabelledBy = $element.attr('aria-labelledby') || '';
                    
                    // Check if this element is likely to be a landmark
                    const isLandmark = epubType || role || 
                                      ['nav', 'aside', 'header', 'footer', 'main', 'section'].includes(tagName);
                    
                    if (isLandmark) {
                        // Check if this element lacks a unique name
                        if (!ariaLabel && !title && !ariaLabelledBy) {
                            this.logger.info(`Found landmark element without unique name: epub:type="${epubType}", role="${role}", tagName="${tagName}"`);
                            
                            // Generate a unique name based on the element type
                            let baseName = '';
                            if (epubType) {
                                baseName = epubType.replace(/-/g, ' ');
                            } else if (role) {
                                baseName = role.replace('doc-', '').replace(/-/g, ' ');
                            } else if (tagName) {
                                baseName = tagName;
                            }
                            
                            if (baseName) {
                                // Capitalize first letter of each word
                                const uniqueName = baseName.replace(/\b\w/g, l => l.toUpperCase());
                                
                                $element.attr('aria-label', uniqueName);
                                fileFixedCount++;
                                totalFixed++;
                                this.logger.info(`Added aria-label="${uniqueName}" to element with epub:type="${epubType}" role="${role}" tagName="${tagName}"`);
                            }
                        }
                    }
                });

                if (fileFixedCount > 0) {
                    this.logger.info(`Saving document with ${fileFixedCount} fixed landmark issues`);
                    this.saveDocument($, content);
                    changedFiles.push(content.path);
                }
            } catch (error) {
                this.logger.warn(`Could not process file ${content.path} for landmark issues: ${error}`);
            }
        }
        
        if (totalFixed > 0) {
            return this.createFixResult(
                true,
                `Made ${totalFixed} landmarks unique by adding accessible names`,
                changedFiles,
                { landmarksFixed: totalFixed, fixDetails }
            );
        }
        
        return this.createFixResult(
            false,
            'No landmark issues found to fix'
        );
    }

    private mapEpubTypeToRole(epubType: string): string | null {
        // Map common epub:type values to their corresponding ARIA roles
        const epubTypeToRoleMap: { [key: string]: string } = {
            'toc': 'doc-toc',
            'landmarks': 'navigation',
            'index': 'doc-index',
            'pagelist': 'doc-pagelist',
            'part': 'doc-part',
            'chapter': 'doc-chapter',
            'appendix': 'doc-appendix',
            'bibliography': 'doc-bibliography',
            'biblioentry': 'doc-biblioentry',
            'biblioref': 'doc-biblioref',
            'glossary': 'doc-glossary',
            'glossdef': 'doc-glossdef',
            'glossref': 'doc-glossref',
            'glossterm': 'doc-glossterm',
            'introduction': 'doc-introduction',
            'noteref': 'doc-noteref',
            'notice': 'doc-notice',
            'pagebreak': 'doc-pagebreak',
            'preface': 'doc-preface',
            'prologue': 'doc-prologue',
            'pullquote': 'doc-pullquote',
            'subtitle': 'doc-subtitle',
            'tip': 'doc-tip',
            'titlepage': 'doc-titlepage',
            'bodymatter': 'doc-chapter', // Often used for main content
            'volume': 'doc-volume',
            'abstract': 'doc-abstract',
            'acknowledgments': 'doc-acknowledgments',
            'afterword': 'doc-afterword',
            'colophon': 'doc-colophon',
            'conclusion': 'doc-conclusion',
        };

        return epubTypeToRoleMap[epubType] || null;
    }
}