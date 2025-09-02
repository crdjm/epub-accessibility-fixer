import { ValidationIssue, FixResult, ProcessingContext, EpubContent } from '../types';
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
            'The landmark must have a unique aria-label, aria-labelledby, or title'
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
            return true;
        }

        // Also check if the message contains the specific patterns we handle
        const messagePatterns = [
            'Landmarks should have a unique role or role/label/title',
            'The landmark must have a unique aria-label, aria-labelledby, or title',
            'landmark must have a unique',
            'Ensure landmarks are unique'
        ];

        return messagePatterns.some(pattern =>
            issue.message.toLowerCase().includes(pattern.toLowerCase())
        );
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

        // Find all elements that could be landmarks
        // This includes elements with epub:type, role, or nav elements
        const potentialLandmarks = $('[epub\\:type], [role], nav');
        
        this.logger.info(`Found ${potentialLandmarks.length} potential landmark elements`);

        // Group elements by their effective role to identify duplicates
        const roleGroups: { [key: string]: any[] } = {};
        
        potentialLandmarks.each((_: number, element: CheerioElement) => {
            const $element = $(element);
            const role = $element.attr('role');
            const epubType = $element.attr('epub:type');
            
            // Create a more precise key for grouping
            // Use both epub:type and role when available to create a unique identifier
            let effectiveRole = '';
            if (epubType && role) {
                // When both are present, use them together as the key
                effectiveRole = `${epubType}|${role}`;
            } else if (role) {
                // If only role is present
                effectiveRole = role;
            } else if (epubType) {
                // If only epub:type is present, try to map it to a role
                const mappedRole = this.mapEpubTypeToRole(epubType);
                if (mappedRole) {
                    effectiveRole = mappedRole;
                } else {
                    // Fallback to epub:type with prefix
                    effectiveRole = `epub:${epubType}`;
                }
            } else {
                // Neither attribute present, skip
                return;
            }
            
            this.logger.info(`Found element with role="${role}" epub:type="${epubType}" effectiveRole="${effectiveRole}"`);
            
            if (!roleGroups[effectiveRole]) {
                roleGroups[effectiveRole] = [];
            }
            roleGroups[effectiveRole].push({
                element: $element,
                epubType: epubType,
                role: role
            });
        });

        // Process each role group to make duplicates unique
        for (const [role, elements] of Object.entries(roleGroups)) {
            this.logger.info(`Processing role group "${role}" with ${elements.length} elements`);
            
            // If there's only one element with this role, no need to make it unique
            if (elements.length <= 1) {
                this.logger.info(`Only ${elements.length} element with role "${role}", no uniqueness needed`);
                continue;
            }

            // For each duplicate, add a unique accessible name
            elements.forEach((elementInfo: any, index: number) => {
                const $element = elementInfo.element;
                const epubType = elementInfo.epubType;
                const role = elementInfo.role;
                
                const existingAriaLabel = $element.attr('aria-label');
                const existingTitle = $element.attr('title');
                const existingAriaLabelledBy = $element.attr('aria-labelledby');
                
                // Skip if it already has a unique accessible name
                if (existingAriaLabel || existingTitle || existingAriaLabelledBy) {
                    this.logger.info(`Element already has accessible name, skipping: aria-label="${existingAriaLabel}", title="${existingTitle}", aria-labelledby="${existingAriaLabelledBy}"`);
                    return;
                }
                
                // Generate a unique accessible name based on epub:type and position
                let uniqueName = '';
                if (epubType) {
                    // Capitalize first letter of epub:type
                    const capitalizedType = epubType.charAt(0).toUpperCase() + epubType.slice(1);
                    uniqueName = `${capitalizedType} ${index + 1}`;
                } else if (role) {
                    // Fallback to role-based name
                    const capitalizedRole = role.replace('doc-', '').replace(/-/g, ' ');
                    uniqueName = `${capitalizedRole} ${index + 1}`;
                } else {
                    uniqueName = `Landmark ${index + 1}`;
                }
                
                // Add the unique accessible name
                $element.attr('aria-label', uniqueName);
                fixedCount++;
                this.logger.info(`Added aria-label="${uniqueName}" to element with role="${role}" epub:type="${epubType}"`);
            });
        }

        // Also specifically check for nav elements which are common landmarks
        const navElements = $('nav');
        this.logger.info(`Found ${navElements.length} nav elements`);
        
        navElements.each((_: number, element: CheerioElement) => {
            const $element = $(element);
            const epubType = $element.attr('epub:type');
            const role = $element.attr('role');
            const existingAriaLabel = $element.attr('aria-label');
            const existingTitle = $element.attr('title');
            const existingAriaLabelledBy = $element.attr('aria-labelledby');
            
            // Skip if it already has a unique accessible name
            if (existingAriaLabel || existingTitle || existingAriaLabelledBy) {
                this.logger.info(`Nav element already has accessible name, skipping: aria-label="${existingAriaLabel}", title="${existingTitle}", aria-labelledby="${existingAriaLabelledBy}"`);
                return;
            }
            
            // Generate a unique accessible name based on epub:type
            let uniqueName = '';
            if (epubType) {
                // Capitalize first letter of epub:type
                const capitalizedType = epubType.charAt(0).toUpperCase() + epubType.slice(1);
                uniqueName = `${capitalizedType} Navigation`;
            } else if (role) {
                const capitalizedRole = role.replace('doc-', '').replace(/-/g, ' ');
                uniqueName = `${capitalizedRole} Navigation`;
            } else {
                // Check if this is a landmarks nav
                if ($element.find('ol > li > a[href]').length > 0) {
                    uniqueName = 'Landmarks Navigation';
                } else {
                    uniqueName = 'Navigation';
                }
            }
            
            // Add the unique accessible name
            $element.attr('aria-label', uniqueName);
            fixedCount++;
            this.logger.info(`Added aria-label="${uniqueName}" to nav element with role="${role}" epub:type="${epubType}"`);
        });

        if (fixedCount > 0) {
            this.logger.info(`Saving document with ${fixedCount} fixed landmark uniqueness issues`);
            this.saveDocument($, content);
        }

        return fixedCount;
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