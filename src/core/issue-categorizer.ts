import { ValidationIssue, AccessibilityIssue, ProcessingContext } from '../types';
import { Logger } from '../utils/common';

export interface IssuePriority {
    category: 'critical' | 'high' | 'medium' | 'low';
    order: number;
    reasoning: string;
}

export interface CategorizedIssues {
    critical: ValidationIssue[];
    high: ValidationIssue[];
    medium: ValidationIssue[];
    low: ValidationIssue[];
    fixable: ValidationIssue[];
    unfixable: ValidationIssue[];
}

export class IssueCategorizer {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    categorizeIssues(issues: ValidationIssue[]): CategorizedIssues {
        const categorized: CategorizedIssues = {
            critical: [],
            high: [],
            medium: [],
            low: [],
            fixable: [],
            unfixable: []
        };

        for (const issue of issues) {
            const priority = this.calculatePriority(issue);

            // Add to priority category
            switch (priority.category) {
                case 'critical':
                    categorized.critical.push(issue);
                    break;
                case 'high':
                    categorized.high.push(issue);
                    break;
                case 'medium':
                    categorized.medium.push(issue);
                    break;
                case 'low':
                    categorized.low.push(issue);
                    break;
            }

            // Add to fixability category
            if (issue.fixable) {
                categorized.fixable.push(issue);
            } else {
                categorized.unfixable.push(issue);
            }
        }

        // Sort each category by order
        this.sortIssuesByPriority(categorized.critical);
        this.sortIssuesByPriority(categorized.high);
        this.sortIssuesByPriority(categorized.medium);
        this.sortIssuesByPriority(categorized.low);
        this.sortIssuesByPriority(categorized.fixable);

        this.logger.info(`Categorized ${issues.length} issues: ${categorized.critical.length} critical, ${categorized.high.length} high, ${categorized.medium.length} medium, ${categorized.low.length} low`);

        return categorized;
    }

    private calculatePriority(issue: ValidationIssue): IssuePriority {
        let order = 0;
        let category: 'critical' | 'high' | 'medium' | 'low' = 'low';
        let reasoning = '';

        // Base priority on issue type and severity
        if (issue.type === 'error') {
            if (issue.severity === 'critical') {
                category = 'critical';
                order = 1000;
                reasoning = 'Critical error that prevents EPUB from functioning';
            } else if (issue.severity === 'major') {
                category = 'high';
                order = 800;
                reasoning = 'Major error that significantly impacts usability';
            } else {
                category = 'medium';
                order = 600;
                reasoning = 'Minor error that may cause issues';
            }
        } else if (issue.type === 'warning') {
            if (issue.severity === 'critical') {
                category = 'high';
                order = 700;
                reasoning = 'Critical warning that should be addressed';
            } else if (issue.severity === 'major') {
                category = 'medium';
                order = 500;
                reasoning = 'Important warning';
            } else {
                category = 'low';
                order = 300;
                reasoning = 'Minor warning';
            }
        } else {
            category = 'low';
            order = 100;
            reasoning = 'Informational issue';
        }

        // Boost priority for accessibility issues
        if (issue.category === 'accessibility') {
            const accessibilityIssue = issue as AccessibilityIssue;

            // WCAG Level A issues are more critical
            if (accessibilityIssue.wcagLevel === 'A') {
                order += 200;
                reasoning += ' (WCAG Level A - essential for accessibility)';
            } else if (accessibilityIssue.wcagLevel === 'AA') {
                order += 100;
                reasoning += ' (WCAG Level AA - important for accessibility)';
            }

            // Impact-based priority boost
            switch (accessibilityIssue.impact) {
                case 'critical':
                    order += 300;
                    reasoning += ' (Critical accessibility impact)';
                    break;
                case 'serious':
                    order += 200;
                    reasoning += ' (Serious accessibility impact)';
                    break;
                case 'moderate':
                    order += 100;
                    reasoning += ' (Moderate accessibility impact)';
                    break;
            }

            // Specific accessibility issue priorities
            if (this.isCriticalAccessibilityIssue(accessibilityIssue.code)) {
                category = Math.max(category === 'critical' ? 4 : category === 'high' ? 3 : category === 'medium' ? 2 : 1, 3) === 4 ? 'critical' :
                    Math.max(category === 'critical' ? 4 : category === 'high' ? 3 : category === 'medium' ? 2 : 1, 3) === 3 ? 'high' :
                        Math.max(category === 'critical' ? 4 : category === 'high' ? 3 : category === 'medium' ? 2 : 1, 3) === 2 ? 'medium' : 'low';
                order += 150;
                reasoning += ' (Critical accessibility barrier)';
            }
        }

        // Boost priority for fixable issues
        if (issue.fixable) {
            order += 50;
            reasoning += ' (Automatically fixable)';
        }

        // Specific code-based priorities
        const codeBoost = this.getCodePriorityBoost(issue.code);
        order += codeBoost.boost;
        if (codeBoost.reasoning) {
            reasoning += ` (${codeBoost.reasoning})`;
        }

        // Recalculate category based on final order
        if (order >= 1000) {
            category = 'critical';
        } else if (order >= 700) {
            category = 'high';
        } else if (order >= 400) {
            category = 'medium';
        } else {
            category = 'low';
        }

        return { category, order, reasoning };
    }

    private isCriticalAccessibilityIssue(code: string): boolean {
        const criticalCodes = [
            'missing-alt-text',
            'image-alt',
            'missing-lang',
            'html-has-lang',
            'heading-structure',
            'heading-order',
            'page-has-heading-one',
            'color-contrast',
            'bypass',
            'label'
        ];

        return criticalCodes.some(criticalCode => code.includes(criticalCode));
    }

    private getCodePriorityBoost(code: string): { boost: number; reasoning: string } {
        const priorityMap: { [key: string]: { boost: number; reasoning: string } } = {
            // Critical validation issues
            'OPF-001': { boost: 200, reasoning: 'Missing OPF file - EPUB cannot function' },
            'OPF-002': { boost: 200, reasoning: 'Invalid OPF structure' },
            'HTM-001': { boost: 150, reasoning: 'Invalid XHTML - breaks reading systems' },
            'HTM-002': { boost: 150, reasoning: 'Malformed HTML structure' },
            'PKG-001': { boost: 100, reasoning: 'Missing manifest entries' },
            'PKG-009': { boost: 100, reasoning: 'Missing spine entries' },

            // Important metadata issues
            'OPF-025': { boost: 75, reasoning: 'Missing language - affects accessibility' },
            'OPF-003': { boost: 50, reasoning: 'Missing required metadata' },
            'HTM-009': { boost: 50, reasoning: 'Missing title element' },

            // Accessibility issues
            'ACC-001': { boost: 100, reasoning: 'Missing accessibility metadata' },
            'ACC-002': { boost: 150, reasoning: 'Missing alt text for images' },
            'ACC-003': { boost: 125, reasoning: 'Poor heading structure' },
            'ACC-004': { boost: 100, reasoning: 'Missing table headers' },
            'ACC-005': { boost: 75, reasoning: 'Missing navigation landmarks' },

            // Media and resources
            'MED-001': { boost: 75, reasoning: 'Invalid media type' },
            'MED-002': { boost: 50, reasoning: 'Missing media files' },
            'CSS-001': { boost: 25, reasoning: 'Invalid CSS' },
            'CSS-002': { boost: 10, reasoning: 'CSS warnings' }
        };

        // Check for exact matches first
        if (priorityMap[code]) {
            return priorityMap[code];
        }

        // Check for partial matches
        for (const [pattern, priority] of Object.entries(priorityMap)) {
            if (code.includes(pattern) || pattern.includes(code)) {
                return priority;
            }
        }

        return { boost: 0, reasoning: '' };
    }

    private sortIssuesByPriority(issues: ValidationIssue[]): void {
        issues.sort((a, b) => {
            const priorityA = this.calculatePriority(a);
            const priorityB = this.calculatePriority(b);

            // Sort by order (descending - higher order = higher priority)
            if (priorityA.order !== priorityB.order) {
                return priorityB.order - priorityA.order;
            }

            // If same order, sort by category
            const categoryOrder = { critical: 4, high: 3, medium: 2, low: 1 };
            const categoryA = categoryOrder[priorityA.category];
            const categoryB = categoryOrder[priorityB.category];

            if (categoryA !== categoryB) {
                return categoryB - categoryA;
            }

            // If same category, sort fixable issues first
            if (a.fixable !== b.fixable) {
                return a.fixable ? -1 : 1;
            }

            // Finally, sort by code
            return a.code.localeCompare(b.code);
        });
    }

    getFixingOrder(issues: ValidationIssue[]): ValidationIssue[] {
        // Create a copy to avoid modifying the original array
        const sortedIssues = [...issues];

        // Only include fixable issues
        const fixableIssues = sortedIssues.filter(issue => issue.fixable);

        // Sort by priority
        this.sortIssuesByPriority(fixableIssues);

        // Group by dependencies - some fixes should be done before others
        const orderedIssues: ValidationIssue[] = [];
        const processedCodes = new Set<string>();

        // First pass: Critical structural issues
        this.addIssuesByType(fixableIssues, orderedIssues, processedCodes, [
            'OPF-', 'PKG-', 'HTM-001', 'HTM-002'
        ]);

        // Second pass: Metadata issues
        this.addIssuesByType(fixableIssues, orderedIssues, processedCodes, [
            'OPF-003', 'OPF-025', 'HTM-009', 'ACC-001'
        ]);

        // Third pass: Content accessibility issues
        this.addIssuesByType(fixableIssues, orderedIssues, processedCodes, [
            'ACC-002', 'ACC-003', 'missing-alt-text', 'heading-structure', 'missing-lang'
        ]);

        // Fourth pass: Navigation and structure
        this.addIssuesByType(fixableIssues, orderedIssues, processedCodes, [
            'ACC-004', 'ACC-005', 'bypass', 'landmark'
        ]);

        // Fifth pass: All remaining issues
        for (const issue of fixableIssues) {
            if (!processedCodes.has(issue.code)) {
                orderedIssues.push(issue);
                processedCodes.add(issue.code);
            }
        }

        this.logger.info(`Ordered ${orderedIssues.length} fixable issues for processing`);
        return orderedIssues;
    }

    private addIssuesByType(
        allIssues: ValidationIssue[],
        orderedIssues: ValidationIssue[],
        processedCodes: Set<string>,
        patterns: string[]
    ): void {
        for (const issue of allIssues) {
            if (!processedCodes.has(issue.code)) {
                const shouldInclude = patterns.some(pattern =>
                    issue.code.includes(pattern) || pattern.includes(issue.code)
                );

                if (shouldInclude) {
                    orderedIssues.push(issue);
                    processedCodes.add(issue.code);
                }
            }
        }
    }

    generateIssueSummary(context: ProcessingContext): {
        total: number;
        byCategory: { [key: string]: number };
        bySeverity: { [key: string]: number };
        fixable: number;
        critical: number;
    } {
        const summary = {
            total: context.issues.length,
            byCategory: { validation: 0, accessibility: 0 },
            bySeverity: { critical: 0, major: 0, minor: 0 },
            fixable: 0,
            critical: 0
        };

        for (const issue of context.issues) {
            summary.byCategory[issue.category]++;
            summary.bySeverity[issue.severity]++;

            if (issue.fixable) {
                summary.fixable++;
            }

            if (issue.severity === 'critical') {
                summary.critical++;
            }
        }

        return summary;
    }
}