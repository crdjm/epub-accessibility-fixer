import * as fs from 'fs-extra';
import * as path from 'path';
import { AnalysisResult, ValidationIssue, AccessibilityIssue, ProcessingContext, FixResult } from '../types';
import { Logger } from '../utils/common';
import { CategorizedIssues } from '../core/issue-categorizer';
import { ImageReviewGenerator } from './image-review-generator';

export interface ReportData {
    epub: {
        title: string;
        path: string;
        size: string;
        metadata: any;
    };
    analysis: {
        timestamp: string;
        duration: number;
        toolVersions: {
            epubcheck?: string;
            ace?: string;
        };
    };
    summary: {
        totalIssues: number;
        criticalIssues: number;
        fixableIssues: number;
        fixedIssues: number;
        validationScore: number;
        accessibilityScore?: number;
    };
    issues: CategorizedIssues;
    fixes: FixResult[];
    recommendations: string[];
}

export class HtmlReportGenerator {
    private logger: Logger;
    private imageReviewGenerator: ImageReviewGenerator;
    private reportData: ReportData | null = null;

    constructor(logger: Logger) {
        this.logger = logger;
        this.imageReviewGenerator = new ImageReviewGenerator(logger);
    }

    async generateReport(
        context: ProcessingContext,
        categorizedIssues: CategorizedIssues,
        fixes: FixResult[],
        outputPath: string,
        analysisStartTime: Date
    ): Promise<void> {
        this.logger.info(`Generating HTML report: ${outputPath}`);

        const reportData = this.prepareReportData(context, categorizedIssues, fixes, analysisStartTime);
        
        // Generate image review page if there are AI analyses
        let imageReviewPath: string | null = null;
        if (context.aiImageAnalyses && context.aiImageAnalyses.length > 0) {
            const reportDir = path.dirname(outputPath);
            const reportBasename = path.basename(outputPath, path.extname(outputPath));
            imageReviewPath = path.join(reportDir, `${reportBasename}_image_review.html`);
            
            await this.imageReviewGenerator.generateImageReviewPage(context, imageReviewPath);
        }
        
        const htmlContent = await this.generateHtmlContent(reportData, imageReviewPath);

        await fs.writeFile(outputPath, htmlContent, 'utf8');
        this.logger.success(`HTML report generated: ${outputPath}`);
        
        if (imageReviewPath) {
            this.logger.success(`Image review page generated: ${imageReviewPath}`);
        }
    }

    private prepareReportData(
        context: ProcessingContext,
        categorizedIssues: CategorizedIssues,
        fixes: FixResult[],
        analysisStartTime: Date
    ): ReportData {
        const epubStats = this.getEpubStats(context);
        const duration = Date.now() - analysisStartTime.getTime();

        const totalIssues = context.issues.length;
        const criticalIssues = categorizedIssues.critical.length;
        // Calculate fixable issues as the count of issues that either:
        // 1. Were initially marked as fixable, OR
        // 2. Actually got fixed (regardless of initial fixable status)
        const initiallyFixable = categorizedIssues.fixable.length;
        const actuallyFixed = context.issues.filter(i => i.fixed === true).length;
        const fixableIssues = Math.max(initiallyFixable, actuallyFixed);
        const fixedIssues = actuallyFixed;

        const validationScore = this.calculateValidationScore(context.issues);
        const accessibilityScore = this.calculateAccessibilityScore(context.issues);

        const reportData = {
            epub: {
                title: context.metadata.title || path.basename(context.epubPath),
                path: context.epubPath,
                size: epubStats.size,
                metadata: context.metadata
            },
            analysis: {
                timestamp: new Date().toISOString(),
                duration,
                toolVersions: {
                    epubcheck: '5.1.0', // Should come from actual tool info
                    ace: 'latest'
                }
            },
            summary: {
                totalIssues,
                criticalIssues,
                fixableIssues,
                fixedIssues,
                validationScore,
                accessibilityScore
            },
            issues: categorizedIssues,
            fixes,
            recommendations: this.generateRecommendations(categorizedIssues)
        };

        // Store the report data for use in other methods
        this.reportData = reportData;
        
        return reportData;
    }

    private getEpubStats(context: ProcessingContext): { size: string; fileCount: number } {
        try {
            const stats = fs.statSync(context.epubPath);
            const size = this.formatFileSize(stats.size);
            const fileCount = context.contents.size;
            return { size, fileCount };
        } catch (error) {
            return { size: 'Unknown', fileCount: context.contents.size };
        }
    }

    private formatFileSize(bytes: number): string {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 Bytes';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    private calculateValidationScore(issues: ValidationIssue[]): number {
        const validationIssues = issues.filter(i => i.category === 'validation' && !i.fixed);
        const errorCount = validationIssues.filter(i => i.type === 'error').length;
        const warningCount = validationIssues.filter(i => i.type === 'warning').length;

        // Simple scoring: start at 100, subtract points for unfixed issues
        let score = 100;
        score -= errorCount * 10; // 10 points per error
        score -= warningCount * 2; // 2 points per warning

        return Math.max(0, score);
    }

    private calculateAccessibilityScore(issues: ValidationIssue[]): number | undefined {
        const accessibilityIssues = issues.filter(i => i.category === 'accessibility' && !i.fixed) as AccessibilityIssue[];

        if (accessibilityIssues.length === 0) {
            // If there are no unfixed accessibility issues, return 100
            const totalAccessibilityIssues = issues.filter(i => i.category === 'accessibility').length;
            return totalAccessibilityIssues > 0 ? 100 : undefined;
        }

        let score = 100;
        for (const issue of accessibilityIssues) {
            switch (issue.impact) {
                case 'critical':
                    score -= 20;
                    break;
                case 'serious':
                    score -= 10;
                    break;
                case 'moderate':
                    score -= 5;
                    break;
                case 'minor':
                    score -= 2;
                    break;
            }
        }

        return Math.max(0, score);
    }

    private generateRecommendations(issues: CategorizedIssues): string[] {
        const recommendations: string[] = [];

        if (issues.critical.length > 0) {
            recommendations.push('Address all critical issues immediately as they prevent proper EPUB functionality.');
        }

        const accessibilityIssues = [...issues.critical, ...issues.high, ...issues.medium, ...issues.low]
            .filter(i => i.category === 'accessibility');

        if (accessibilityIssues.length > 0) {
            recommendations.push('Prioritize accessibility fixes to ensure content is usable by people with disabilities.');
        }

        const missingAltText = issues.fixable.filter(i => i.code.includes('alt-text') || i.code.includes('image-alt'));
        if (missingAltText.length > 0) {
            recommendations.push('Add meaningful alternative text to all images for screen reader users.');
        }

        const headingIssues = issues.fixable.filter(i => i.code.includes('heading'));
        if (headingIssues.length > 0) {
            recommendations.push('Fix heading structure to improve navigation for assistive technology users.');
        }

        const languageIssues = issues.fixable.filter(i => i.code.includes('lang'));
        if (languageIssues.length > 0) {
            recommendations.push('Add language attributes to help screen readers pronounce content correctly.');
        }

        if (issues.fixable.length > issues.fixable.filter(i => i.fixed).length) {
            recommendations.push('Run the tool with fix mode enabled to automatically resolve identified issues.');
        }

        return recommendations;
    }

    private async generateHtmlContent(data: ReportData, imageReviewPath?: string | null): Promise<string> {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EPUB Accessibility Report - ${data.epub.title}</title>
    <style>
        ${this.getReportStyles()}
    </style>
</head>
<body>
    <div class="container">
        <header class="report-header">
            <h1>EPUB Accessibility Report</h1>
            <div class="epub-info">
                <h2>${data.epub.title}</h2>
                <p class="epub-path">${data.epub.path}</p>
                <p class="epub-size">Size: ${data.epub.size}</p>
            </div>
        </header>

        <section class="summary">
            <h2>Summary</h2>
            <div class="summary-grid">
                <div class="summary-card">
                    <h3>Total Issues</h3>
                    <div class="summary-number">${data.summary.totalIssues}</div>
                </div>
                <div class="summary-card critical">
                    <h3>Critical Issues</h3>
                    <div class="summary-number">${data.summary.criticalIssues}</div>
                </div>
                <div class="summary-card">
                    <h3>Fixable Issues</h3>
                    <div class="summary-number">${data.summary.fixableIssues}</div>
                </div>
                <div class="summary-card success">
                    <h3>Fixed Issues</h3>
                    <div class="summary-number">${data.summary.fixedIssues}</div>
                </div>
            </div>
            
            ${imageReviewPath ? `
            <div class="image-review-section">
                <h3>🖼️ AI-Generated Alt Text Review</h3>
                <div class="review-notice">
                    <p>This analysis included AI-generated alternative text for images. Please review these for accuracy and appropriateness.</p>
                    <a href="${path.basename(imageReviewPath)}" class="review-link" target="_blank">
                        📝 Review AI-Generated Alt Text
                        <span class="review-count">(${data.epub.metadata.accessibility?.accessibilityFeature?.includes('alternativeText') ? 'Multiple images' : 'View details'})</span>
                    </a>
                </div>
            </div>
            ` : ''}
            
            <div class="scores">
                <div class="score-item">
                    <label>Validation Score:</label>
                    <div class="score ${this.getScoreClass(data.summary.validationScore)}">${data.summary.validationScore}/100</div>
                </div>
                ${data.summary.accessibilityScore !== undefined ? `
                <div class="score-item">
                    <label>Accessibility Score:</label>
                    <div class="score ${this.getScoreClass(data.summary.accessibilityScore)}">${data.summary.accessibilityScore}/100</div>
                </div>
                ` : ''}
            </div>
        </section>

        ${data.recommendations.length > 0 ? `
        <section class="recommendations">
            <h2>Recommendations</h2>
            <ul>
                ${data.recommendations.map(rec => `<li>${rec}</li>`).join('')}
            </ul>
        </section>
        ` : ''}

        <section class="issues">
            <h2>Issues by Priority</h2>
            
            ${this.generateIssueSection('Critical Issues', data.issues.critical, 'critical')}
            ${this.generateIssueSection('High Priority Issues', data.issues.high, 'high')}
            ${this.generateIssueSection('Medium Priority Issues', data.issues.medium, 'medium')}
            ${this.generateIssueSection('Low Priority Issues', data.issues.low, 'low')}
        </section>

        ${data.fixes.length > 0 ? `
        <section class="fixes">
            <h2>Applied Fixes</h2>
            <div class="fixes-list">
                ${data.fixes.map(fix => this.generateFixItem(fix)).join('')}
            </div>
        </section>
        ` : ''}

        <section class="metadata">
            <h2>EPUB Metadata</h2>
            <div class="metadata-grid">
                ${Object.entries(data.epub.metadata).map(([key, value]) => `
                    <div class="metadata-item">
                        <label>${key}:</label>
                        <span>${Array.isArray(value) ? value.join(', ') : value || 'Not specified'}</span>
                    </div>
                `).join('')}
            </div>
        </section>

        <footer class="report-footer">
            <p>Generated on ${new Date(data.analysis.timestamp).toLocaleString()}</p>
            <p>Analysis duration: ${Math.round(data.analysis.duration / 1000)}s</p>
            <p>Tools: EpubCheck ${data.analysis.toolVersions.epubcheck}, DAISY ACE ${data.analysis.toolVersions.ace}</p>
        </footer>
    </div>

    <script>
        ${this.getReportScript()}
    </script>
</body>
</html>`;
    }

    private generateIssueSection(title: string, issues: ValidationIssue[], priority: string): string {
        if (issues.length === 0) {
            return '';
        }

        return `
    <div class="issue-section">
        <h3>${title} (${issues.length})</h3>
        <div class="issues-list">
            ${issues.map(issue => this.generateIssueItem(issue, priority)).join('')}
        </div>
    </div>`;
    }

    private generateIssueItem(issue: ValidationIssue, priority: string): string {
        const accessibilityIssue = issue as AccessibilityIssue;
        const isAccessibility = issue.category === 'accessibility';

        // Generate fix details HTML if the issue is fixed
        let fixDetailsHtml = '';
        if (issue.fixed && this.reportData?.fixes) {
            const fixDetails = this.findFixDetailsForIssue(issue, this.reportData.fixes);
            if (fixDetails && fixDetails.length > 0) {
                fixDetailsHtml = `
                <div class="issue-fix-details">
                    <h4>Brief Fix Details</h4>
                    ${fixDetails.map(detail => `
                    <div class="issue-fix-detail-item">
                        <div class="fix-explanation">${detail.explanation}</div>
                        ${detail.element ? `<div class="fix-element">Element: &lt;${detail.element}&gt;</div>` : ''}
                    </div>
                    `).join('')}
                </div>
                `;
            }
        }

        // Add special note for OPF-014 issues
        let specialNoteHtml = '';
        if (issue.code === 'OPF-014') {
            specialNoteHtml = `
            <div class="special-note">
                <strong>Note:</strong> This issue indicates that the EPUB contains remote resources (like images or scripts hosted online). 
                Automatically downloading and embedding these resources is not performed by this tool as it may violate terms of service, 
                consume significant bandwidth, or alter the intended content. To fix this manually:
                <ul>
                    <li>Download the remote resources to your local machine</li>
                    <li>Add them to the EPUB package</li>
                    <li>Update all references to use local paths instead of URLs</li>
                    <li>Add the "remote-resources" property to the relevant manifest items</li>
                </ul>
            </div>
            `;
        }

        return `
    <div class="issue-item ${priority} ${issue.fixed ? 'fixed' : ''}">
        <div class="issue-header">
            <span class="issue-code">${issue.code}</span>
            <span class="issue-type ${issue.type}">${issue.type.toUpperCase()}</span>
            ${issue.fixable ? '<span class="fixable">FIXABLE</span>' : ''}
            ${issue.fixed ? '<span class="fixed-badge">FIXED</span>' : ''}
        </div>
        <div class="issue-message">${issue.message}</div>
        ${issue.location ? `
        <div class="issue-location">
            ${issue.location.file ? `File: ${issue.location.file}` : ''}
            ${issue.location.line ? ` (Line ${issue.location.line})` : ''}
        </div>
        ` : ''}
        ${isAccessibility && accessibilityIssue.wcagCriteria ? `
        <div class="wcag-info">
            WCAG ${accessibilityIssue.wcagLevel}: ${accessibilityIssue.wcagCriteria.join(', ')}
            <span class="impact ${accessibilityIssue.impact}">Impact: ${accessibilityIssue.impact}</span>
        </div>
        ` : ''}
        ${issue.details ? `<div class="issue-details">${issue.details}</div>` : ''}
        ${specialNoteHtml}
        ${fixDetailsHtml}
    </div>`;
    }

    private generateFixItem(fix: FixResult): string {
        let fixDetailsHtml = '';
        
        // Check for fix details in both locations (backward compatibility)
        const fixDetails = fix.fixDetails || fix.details?.fixDetails;
        if (fixDetails && fixDetails.length > 0) {
            fixDetailsHtml = `
            <div class="fix-details">
                <h4>Detailed Changes</h4>
                ${fixDetails.map(detail => `
                <div class="fix-detail-item">
                    <div class="fix-explanation">${detail.explanation}</div>
                    <div class="fix-file-path">File: ${detail.filePath}</div>
                    ${detail.originalContent || detail.fixedContent ? `
                    <div class="fix-content-comparison">
                        ${detail.originalContent ? `
                        <div class="content-before">
                            <label>Before:</label>
                            <pre class="code-snippet">${this.escapeHtml(detail.originalContent)}</pre>
                        </div>
                        ` : ''}
                        ${detail.fixedContent ? `
                        <div class="content-after">
                            <label>After:</label>
                            <pre class="code-snippet">${this.escapeHtml(detail.fixedContent)}</pre>
                        </div>
                        ` : ''}
                    </div>
                    ` : ''}
                </div>
                `).join('')}
            </div>
            `;
        }

        return `
    <div class="fix-item ${fix.success ? 'success' : 'failed'}">
        <div class="fix-status">${fix.success ? '✓' : '✗'}</div>
        <div class="fix-content">
            <div class="fix-message">${fix.message}</div>
            ${fix.changedFiles && fix.changedFiles.length > 0 ? `
            <div class="fix-files">Changed files: ${fix.changedFiles.join(', ')}</div>
            ` : ''}
            ${fixDetailsHtml}
        </div>
    </div>`;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private getScoreClass(score: number): string {
        if (score >= 90) return 'excellent';
        if (score >= 70) return 'good';
        if (score >= 50) return 'fair';
        return 'poor';
    }

    /**
     * Find fix details for a specific issue based on file path and issue characteristics
     */
    private findFixDetailsForIssue(issue: ValidationIssue, fixes: FixResult[]): any[] | null {
        if (!issue.fixed || !issue.location?.file) {
            return null;
        }

        // Extract filename from the issue location for partial matching
        const issueFileName = issue.location.file.split('/').pop() || issue.location.file;

        // Collect all relevant fix details from all fixes
        let allRelevantDetails: any[] = [];

        // Look through all fix results for relevant details
        for (const fix of fixes) {
            // Check for fix details in both locations (backward compatibility)
            const fixDetails = fix.fixDetails || fix.details?.fixDetails;
            if (fixDetails && Array.isArray(fixDetails)) {
                // Filter fix details to only those relevant to this issue
                const relevantDetails = fixDetails.filter(detail => {
                    // First check file path match (exact, partial, or case-insensitive)
                    const filePathMatch = 
                        detail.filePath === issue.location?.file ||
                        detail.filePath.split('/').pop() === issueFileName ||
                        detail.filePath.toLowerCase() === issue.location?.file.toLowerCase() ||
                        detail.filePath.split('/').pop()?.toLowerCase() === issueFileName.toLowerCase();
                    
                    if (!filePathMatch) {
                        return false;
                    }
                    
                    // If we have a selector in the fix detail, try to match it with the issue
                    if (detail.selector) {
                        // For image issues, check if the selector indicates an image element
                        if (issue.code === 'image-alt' && detail.selector.includes('img')) {
                            // For image-alt issues, we want to be more specific
                            // Check if we can match based on the specific image element
                            if (issue.message.includes('src=')) {
                                // Extract src from issue message if available
                                const srcMatch = issue.message.match(/src="([^"]+)"/);
                                if (srcMatch && detail.selector.includes(srcMatch[1])) {
                                    return true;
                                }
                            }
                            return true;
                        }
                        // For heading issues, check if the selector indicates a heading element
                        if ((issue.code === 'heading-order' || issue.code === 'heading-structure') && 
                            detail.selector.match(/h[1-6]/)) {
                            // For heading-order issues, try to match the specific heading text
                            // Extract heading text from the issue message if available
                            const headingTextMatch = issue.message.match(/"([^"]+)"/);
                            if (headingTextMatch && detail.selector.includes(headingTextMatch[1])) {
                                return true;
                            }
                            // If we can't match specific text, we'll limit the number of fixes shown later
                            return true;
                        }
                        // For link issues, check if the selector indicates a link element
                        if ((issue.code === 'link-in-text-block' || issue.code === 'link-name') && 
                            detail.selector.includes('a')) {
                            return true;
                        }
                        // For language issues, check if the selector indicates html or body elements
                        if ((issue.code === 'epub-lang' || issue.code === 'html-has-lang' || issue.code === 'missing-lang') && 
                            (detail.selector.includes('html') || detail.selector.includes('body') || detail.selector.includes('package'))) {
                            return true;
                        }
                    }
                    
                    // If we have issue code in the fix detail, match it with the issue code
                    if (detail.issueCode) {
                        return detail.issueCode === issue.code;
                    }
                    
                    // If we have issue message in the fix detail, check if it's related to the issue
                    if (detail.issueMessage) {
                        return detail.issueMessage.includes(issue.code) || 
                               issue.message.includes(detail.issueMessage) ||
                               detail.issueMessage.includes(issue.message);
                    }
                    
                    // For epub-lang issues, be more specific about what fix details to show
                    if (issue.code === 'epub-lang') {
                        // Only show fix details related to language metadata
                        const explanationLower = (detail.explanation || '').toLowerCase();
                        return explanationLower.includes('language') && 
                               (explanationLower.includes('metadata') || 
                                explanationLower.includes('xml:lang') || 
                                explanationLower.includes('dc:language'));
                    }
                    
                    // For metadata issues, be more specific about what fix details to show
                    if (issue.code.includes('metadata') || issue.code.includes('accessibility')) {
                        // Only show fix details related to metadata
                        const explanationLower = (detail.explanation || '').toLowerCase();
                        return explanationLower.includes('metadata') || 
                               explanationLower.includes('schema:') ||
                               explanationLower.includes('accessibility');
                    }
                    
                    // If no specific issue information, match by file only (fallback)
                    return true;
                });
                
                // Add relevant details to our collection
                allRelevantDetails.push(...relevantDetails);
            }
        }

        // Limit the number of fix details shown to avoid overwhelming the user
        // For issues that typically have multiple instances (like image-alt and link issues),
        // show only one representative fix detail
        if (allRelevantDetails.length > 1) {
            // For image-alt issues, show only one fix detail
            if (issue.code === 'image-alt') {
                return [allRelevantDetails[0]];
            }
            
            // For link-related issues, show only one fix detail
            if (issue.code === 'link-in-text-block' || issue.code === 'link-name') {
                return [allRelevantDetails[0]];
            }
            
            // For language-related issues, show only one fix detail
            if (issue.code === 'epub-lang' || issue.code === 'html-has-lang' || issue.code === 'missing-lang') {
                // Filter to only show language-related fix details
                const languageDetails = allRelevantDetails.filter(detail => {
                    const explanationLower = (detail.explanation || '').toLowerCase();
                    return explanationLower.includes('language') && 
                           (explanationLower.includes('metadata') || 
                            explanationLower.includes('xml:lang') || 
                            explanationLower.includes('dc:language'));
                });
                return languageDetails.length > 0 ? [languageDetails[0]] : [allRelevantDetails[0]];
            }
            
            // For heading-order issues, show only one fix detail since we can't match specific headings
            if (issue.code === 'heading-order' || issue.code === 'heading-structure') {
                return [allRelevantDetails[0]];
            }
            
            // For metadata issues, show only one fix detail that matches the specific metadata type
            if (issue.code.includes('metadata') || issue.code.includes('accessibility')) {
                // Try to find a fix detail that matches the specific metadata type
                const specificFix = allRelevantDetails.find(detail => {
                    // Check if the explanation mentions the specific metadata type
                    if (detail.explanation && issue.code) {
                        const issueCodeLower = issue.code.toLowerCase();
                        const explanationLower = detail.explanation.toLowerCase();
                        
                        // Match specific metadata types
                        if (issueCodeLower.includes('accessmode') && explanationLower.includes('accessmode')) {
                            return true;
                        }
                        if (issueCodeLower.includes('accessmodesufficient') && explanationLower.includes('accessmodesufficient')) {
                            return true;
                        }
                        if (issueCodeLower.includes('accessibilityfeature') && explanationLower.includes('accessibilityfeature')) {
                            return true;
                        }
                        if (issueCodeLower.includes('accessibilityhazard') && explanationLower.includes('accessibilityhazard')) {
                            return true;
                        }
                        if (issueCodeLower.includes('accessibilitysummary') && explanationLower.includes('accessibilitysummary')) {
                            return true;
                        }
                        // For epub-lang, show language-related metadata fixes
                        if (issueCodeLower === 'epub-lang' && 
                            (explanationLower.includes('language') || explanationLower.includes('xml:lang') || explanationLower.includes('dc:language'))) {
                            return true;
                        }
                    }
                    return false;
                });
                
                // If we found a specific fix, return it; otherwise return the first one
                return [specificFix || allRelevantDetails[0]];
            }
            
            // For RSC-005 issues, show only one fix detail since they can have multiple related fixes
            if (issue.code === 'RSC-005') {
                // Try to find a fix detail that matches the specific RSC-005 issue type
                const specificFix = allRelevantDetails.find(detail => {
                    // Check if the explanation mentions the specific RSC-005 issue type
                    if (detail.explanation && issue.message) {
                        const issueMessageLower = issue.message.toLowerCase();
                        const explanationLower = detail.explanation.toLowerCase();
                        
                        // Match specific RSC-005 issue types
                        if (issueMessageLower.includes('page-map') && explanationLower.includes('page-map')) {
                            return true;
                        }
                        if (issueMessageLower.includes('http-equiv') && explanationLower.includes('http-equiv')) {
                            return true;
                        }
                        if (issueMessageLower.includes('role') && explanationLower.includes('role')) {
                            return true;
                        }
                        if (issueMessageLower.includes('xsi:type') && explanationLower.includes('xsi:type')) {
                            return true;
                        }
                    }
                    return false;
                });
                
                // If we found a specific fix, return it; otherwise return the first one
                // BUT limit to only one fix detail to avoid showing duplicates
                return [specificFix || allRelevantDetails[0]];
            }
            
            // For other issue types with many fixes, limit to a reasonable number
            if (allRelevantDetails.length > 5) {
                return allRelevantDetails.slice(0, 3); // Show first 3 fixes
            }
        }

        // Return all relevant details, or null if none found
        return allRelevantDetails.length > 0 ? allRelevantDetails : null;
    }

    private getReportStyles(): string {
        return `
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .report-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .report-header h1 { margin: 0 0 20px 0; font-size: 2.5em; }
        .epub-info h2 { margin: 0 0 10px 0; opacity: 0.9; }
        .epub-path { font-family: monospace; opacity: 0.8; margin: 5px 0; }
        .epub-size { opacity: 0.8; margin: 5px 0; }
        
        .summary { padding: 30px; border-bottom: 1px solid #eee; }
        .summary h2 { margin-top: 0; color: #333; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .summary-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
        .summary-card.critical { background: #ffe6e6; }
        .summary-card.success { background: #e6f7e6; }
        .summary-card h3 { margin: 0 0 10px 0; color: #666; font-size: 0.9em; text-transform: uppercase; }
        .summary-number { font-size: 2.5em; font-weight: bold; color: #333; }
        
        .scores { display: flex; gap: 30px; }
        .score { padding: 8px 16px; border-radius: 20px; font-weight: bold; }
        .score.excellent { background: #d4edda; color: #155724; }
        .score.good { background: #d1ecf1; color: #0c5460; }
        .score.fair { background: #fff3cd; color: #856404; }
        .score.poor { background: #f8d7da; color: #721c24; }
        
        .image-review-section { 
            background: #f0f9ff; 
            border: 1px solid #bae6fd; 
            border-radius: 8px; 
            padding: 20px; 
            margin: 20px 0; 
        }
        
        .image-review-section h3 { 
            margin: 0 0 15px 0; 
            color: #0c4a6e; 
        }
        
        .review-notice { 
            display: flex; 
            flex-direction: column; 
            gap: 15px; 
        }
        
        .review-notice p { 
            margin: 0; 
            color: #0f172a; 
        }
        
        .review-link { 
            display: inline-flex; 
            align-items: center; 
            gap: 8px; 
            background: #2563eb; 
            color: white; 
            text-decoration: none; 
            padding: 12px 20px; 
            border-radius: 6px; 
            font-weight: 500; 
            transition: all 0.2s ease; 
            align-self: flex-start;
        }
        
        .review-link:hover { 
            background: #1d4ed8; 
            transform: translateY(-1px); 
            box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); 
        }
        
        .review-count { 
            background: rgba(255,255,255,0.2); 
            padding: 2px 8px; 
            border-radius: 12px; 
            font-size: 0.85em; 
        }
        
        .recommendations { padding: 30px; border-bottom: 1px solid #eee; }
        .recommendations h2 { margin-top: 0; color: #333; }
        .recommendations ul { padding-left: 20px; }
        .recommendations li { margin-bottom: 10px; }
        
        .issues { padding: 30px; }
        .issues h2 { margin-top: 0; color: #333; }
        .issue-section { margin-bottom: 30px; }
        .issue-section h3 { color: #555; border-bottom: 2px solid #eee; padding-bottom: 10px; }
        
        .issue-item { border: 1px solid #ddd; border-radius: 6px; padding: 15px; margin-bottom: 10px; background: white; }
        .issue-item.critical { border-left: 4px solid #dc3545; }
        .issue-item.high { border-left: 4px solid #fd7e14; }
        .issue-item.medium { border-left: 4px solid #ffc107; }
        .issue-item.low { border-left: 4px solid #28a745; }
        .issue-item.fixed { background: #f8f9fa; opacity: 0.8; }
        
        .issue-header { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }
        .issue-code { background: #e9ecef; padding: 4px 8px; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
        .issue-type { padding: 4px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; }
        .issue-type.error { background: #dc3545; color: white; }
        .issue-type.warning { background: #ffc107; color: black; }
        .issue-type.info { background: #17a2b8; color: white; }
        .fixable { background: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8em; }
        .fixed-badge { background: #6c757d; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8em; }
        
        .issue-message { font-weight: 500; margin-bottom: 8px; }
        .issue-location { font-size: 0.9em; color: #666; font-family: monospace; }
        .issue-details { font-size: 0.9em; color: #666; margin-top: 8px; }
        
        .special-note {
            margin-top: 10px;
            padding: 10px;
            background-color: #fff3cd;
            border-left: 3px solid #ffc107;
            border-radius: 4px;
            font-size: 0.9em;
        }
        .special-note strong {
            color: #856404;
        }
        .special-note ul {
            margin: 8px 0 0 20px;
            padding: 0;
        }
        .special-note li {
            margin-bottom: 5px;
        }
        
        .issue-fix-details { 
            margin-top: 10px; 
            padding: 10px; 
            background-color: #e8f5e9; 
            border-left: 3px solid #4caf50; 
            border-radius: 4px; 
        }
        .issue-fix-details h4 { 
            margin: 0 0 8px 0; 
            color: #2e7d32; 
            font-size: 0.9em; 
        }
        .issue-fix-detail-item { 
            margin-bottom: 8px; 
            padding-bottom: 8px; 
            border-bottom: 1px solid #c8e6c9; 
        }
        .issue-fix-detail-item:last-child { 
            margin-bottom: 0; 
            padding-bottom: 0; 
            border-bottom: none; 
        }
        .fix-explanation { 
            font-size: 0.85em; 
            color: #333; 
            margin-bottom: 4px; 
        }
        .fix-element { 
            font-size: 0.8em; 
            color: #666; 
            font-family: monospace; 
        }
        
        .wcag-info { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 0.9em; }
        .impact { padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .impact.critical { background: #dc3545; color: white; }
        .impact.serious { background: #fd7e14; color: white; }
        .impact.moderate { background: #ffc107; color: black; }
        .impact.minor { background: #28a745; color: white; }
        
        .fixes { padding: 30px; border-top: 1px solid #eee; }
        .fixes h2 { margin-top: 0; color: #333; }
        .fix-item { display: flex; gap: 15px; padding: 15px; margin-bottom: 10px; border-radius: 6px; }
        .fix-item.success { background: #d4edda; }
        .fix-item.failed { background: #f8d7da; }
        .fix-status { font-size: 1.5em; font-weight: bold; }
        .fix-message { font-weight: 500; }
        .fix-files { font-size: 0.9em; color: #666; margin-top: 5px; }
        
        .fix-details { margin-top: 15px; padding: 15px; background: rgba(255,255,255,0.7); border-radius: 4px; }
        .fix-details h4 { margin-top: 0; color: #333; }
        .fix-detail-item { margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #eee; }
        .fix-detail-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
        .fix-detail-item .fix-explanation { font-weight: 500; margin-bottom: 8px; }
        .fix-file-path { font-size: 0.9em; color: #666; margin-bottom: 10px; }
        .fix-content-comparison { 
            display: grid; 
            grid-template-columns: 1fr; 
            gap: 15px; 
            margin-top: 10px;
        }
        .content-before, .content-after { }
        .content-before label, .content-after label { 
            display: block; 
            font-weight: bold; 
            margin-bottom: 5px; 
        }
        .content-before label { color: #dc3545; }
        .content-after label { color: #28a745; }
        .code-snippet { 
            background: #f8f9fa; 
            padding: 10px; 
            border-radius: 4px; 
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; 
            font-size: 0.85em; 
            overflow-x: auto; 
            margin: 0; 
            white-space: pre-wrap;
            word-break: break-all;
        }
        
        .metadata { padding: 30px; border-top: 1px solid #eee; }
        .metadata h2 { margin-top: 0; color: #333; }
        .metadata-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; }
        .metadata-item { display: flex; gap: 10px; }
        .metadata-item label { font-weight: bold; min-width: 120px; }
        
        .report-footer { padding: 20px 30px; background: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center; color: #666; font-size: 0.9em; }
        .report-footer p { margin: 5px 0; }
        
        @media (min-width: 769px) {
            .fix-content-comparison { grid-template-columns: 1fr 1fr; }
        }
        
        @media (max-width: 768px) {
            .summary-grid { grid-template-columns: 1fr; }
            .scores { flex-direction: column; }
            .metadata-grid { grid-template-columns: 1fr; }
            .issue-header { flex-wrap: wrap; }
            .fix-content-comparison { grid-template-columns: 1fr; }
        }
    `;
    }

    private getReportScript(): string {
        return `
        // Add collapsible functionality to issue sections
        document.querySelectorAll('.issue-section h3').forEach(header => {
            header.style.cursor = 'pointer';
            header.addEventListener('click', () => {
                const issuesList = header.nextElementSibling;
                if (issuesList.style.display === 'none') {
                    issuesList.style.display = 'block';
                    header.textContent = header.textContent.replace('▶', '▼');
                } else {
                    issuesList.style.display = 'none';
                    header.textContent = header.textContent.replace('▼', '▶');
                }
            });
        });

        // Add filter functionality
        const style = document.createElement('style');
        style.textContent = \`
            .filter-controls { margin: 20px 0; display: flex; gap: 10px; flex-wrap: wrap; }
            .filter-btn { padding: 8px 16px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; }
            .filter-btn.active { background: #007bff; color: white; }
        \`;
        document.head.appendChild(style);

        // Add filter controls
        const issuesSection = document.querySelector('.issues');
        if (issuesSection) {
            const filterControls = document.createElement('div');
            filterControls.className = 'filter-controls';
            filterControls.innerHTML = \`
                <button class="filter-btn active" data-filter="all">All Issues</button>
                <button class="filter-btn" data-filter="fixable">Fixable Only</button>
                <button class="filter-btn" data-filter="fixed">Fixed Only</button>
                <button class="filter-btn" data-filter="unfixed">Unfixed Only</button>
            \`;
            
            issuesSection.insertBefore(filterControls, issuesSection.querySelector('h2').nextSibling);
            
            filterControls.addEventListener('click', (e) => {
                if (e.target.classList.contains('filter-btn')) {
                    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
                    e.target.classList.add('active');
                    
                    const filter = e.target.dataset.filter;
                    document.querySelectorAll('.issue-item').forEach(item => {
                        let show = true;
                        
                        switch(filter) {
                            case 'fixable':
                                show = item.querySelector('.fixable') !== null;
                                break;
                            case 'fixed':
                                show = item.classList.contains('fixed');
                                break;
                            case 'unfixed':
                                show = !item.classList.contains('fixed');
                                break;
                        }
                        
                        item.style.display = show ? 'block' : 'none';
                    });
                }
            });
        }
    `;
    }
}