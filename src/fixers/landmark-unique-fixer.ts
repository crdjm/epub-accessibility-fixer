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
        this.logger.info(`Fixing landmark unique issue: ${issue.message}`);
        this.logger.info(`Issue location: ${issue.location?.file || 'global'}`);

        try {
            const changedFiles: string[] = [];
            let totalFixed = 0;

            // If issue specifies a file, fix only that file
            if (issue.location?.file) {
                this.logger.info(`Processing specific file: ${issue.location.file}`);
                const content = this.findContentByPath(context, issue.location.file);

                if (content) {
                    this.logger.info(`Found content for file: ${content.path}`);
                    const fixed = await this.fixLandmarkUniquenessInFile(content, context, issue);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                        this.logger.info(`Fixed ${fixed} landmark uniqueness issues in ${content.path}`);
                    } else {
                        this.logger.info(`No landmark uniqueness issues fixed in ${content.path}`);
                    }
                } else {
                    this.logger.warn(`Could not find content for file: ${issue.location.file}`);
                    // List available files for debugging
                    this.logger.info('Available files:');
                    for (const [path] of context.contents) {
                        this.logger.info(`  - ${path}`);
                    }
                    
                    // Try to process all files as a fallback
                    this.logger.info('Processing all content files as fallback');
                    const contentFiles = this.getAllContentFiles(context);
                    this.logger.info(`Found ${contentFiles.length} content files to check`);

                    for (const content of contentFiles) {
                        const fixed = await this.fixLandmarkUniquenessInFile(content, context, issue);
                        if (fixed > 0) {
                            changedFiles.push(content.path);
                            totalFixed += fixed;
                            this.logger.info(`Fixed ${fixed} landmark uniqueness issues in ${content.path}`);
                        }
                    }
                }
            } else {
                // Fix all content files that might have landmark issues
                this.logger.info('Processing all content files for landmark issues');
                const contentFiles = this.getAllContentFiles(context);
                this.logger.info(`Found ${contentFiles.length} content files to check`);

                for (const content of contentFiles) {
                    const fixed = await this.fixLandmarkUniquenessInFile(content, context, issue);
                    if (fixed > 0) {
                        changedFiles.push(content.path);
                        totalFixed += fixed;
                        this.logger.info(`Fixed ${fixed} landmark uniqueness issues in ${content.path}`);
                    }
                }
            }

            if (totalFixed > 0) {
                return this.createFixResult(
                    true,
                    `Made ${totalFixed} landmarks unique by adding accessible names`,
                    changedFiles,
                    { landmarksFixed: totalFixed }
                );
            } else {
                // Special handling for duplicate banner issues
                if (issue.message.includes('banner') && issue.message.includes('duplicate')) {
                    this.logger.info('Attempting to fix duplicate banner issue specifically');
                    const result = await this.fixDuplicateBannerIssue(context);
                    if (result.success) {
                        return result;
                    }
                }
                
                return this.createFixResult(
                    false,
                    'No landmark uniqueness issues found to fix'
                );
            }

        } catch (error) {
            this.logger.error(`Landmark unique fix failed: ${error}`);
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

        // Find all content files
        const contentFiles = this.getAllContentFiles(context);
        
        // Track banner landmarks across all files
        const bannerLandmarks: Array<{content: EpubContent, $: CheerioStatic, element: any, $element: any}> = [];
        
        // First pass: collect all banner landmarks
        for (const content of contentFiles) {
            try {
                const $ = this.loadDocument(content);
                
                // Find elements that are banner landmarks
                // Look for elements with role="banner" or epub:type="banner"
                const bannerElements = $('[role="banner"], [epub\\:type="banner"], header[role!="banner"][epub\\:type!="banner"]:first').toArray();
                
                for (const element of bannerElements) {
                    const $element = $(element);
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
            // Keep the first banner landmark, make others non-banner landmarks
            for (let i = 1; i < bannerLandmarks.length; i++) {
                const {content, $, element, $element} = bannerLandmarks[i];
                
                // Change the role from "banner" to something else or remove it
                const originalRole = $element.attr('role');
                const originalEpubType = $element.attr('epub:type');
                const originalHtml = $.html($element);
                
                // Remove banner role
                if (originalRole === 'banner') {
                    $element.removeAttr('role');
                }
                
                // Remove banner epub:type
                if (originalEpubType === 'banner') {
                    $element.removeAttr('epub:type');
                }
                
                // Add a more appropriate role if possible
                const tagName = $element.prop('tagName')?.toLowerCase();
                if (tagName === 'header') {
                    // Headers can be given a banner role, but if we already have one,
                    // we should use a different role or just add an aria-label
                    $element.attr('role', 'contentinfo'); // Or another appropriate role
                }
                
                // Ensure the element still has an accessible name
                if (!$element.attr('aria-label') && !$element.attr('aria-labelledby') && !$element.attr('title')) {
                    $element.attr('aria-label', 'Page Header'); // Generic label
                }
                
                const fixedHtml = $.html($element);
                fixDetails.push({
                    filePath: content.path,
                    originalContent: originalHtml,
                    fixedContent: fixedHtml,
                    explanation: `Changed duplicate banner landmark to contentinfo role to avoid duplication`,
                    element: tagName || 'element',
                    attribute: 'role',
                    oldValue: 'banner',
                    newValue: 'contentinfo'
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
        }
        
        return this.createFixResult(
            false,
            'No duplicate banner landmarks found to fix'
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