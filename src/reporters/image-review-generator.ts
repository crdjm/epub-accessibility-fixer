import * as fs from 'fs-extra';
import * as path from 'path';
import { AIImageAnalysis, ProcessingContext } from '../types';
import { Logger } from '../utils/common';

export class ImageReviewGenerator {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    async generateImageReviewPage(
        context: ProcessingContext,
        outputPath: string
    ): Promise<boolean> {
        // Check if there are any AI image analyses to review
        if (!context.aiImageAnalyses || context.aiImageAnalyses.length === 0) {
            this.logger.info('No AI-generated alt text to review');
            return false;
        }

        this.logger.info(`Generating image review page: ${outputPath}`);

        const htmlContent = this.generateReviewPageHTML(context);
        await fs.writeFile(outputPath, htmlContent, 'utf8');

        this.logger.success(`Image review page generated: ${outputPath}`);
        return true;
    }

    private generateReviewPageHTML(context: ProcessingContext): string {
        const analyses = context.aiImageAnalyses || [];
        const epubTitle = context.metadata.title || path.basename(context.epubPath);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI-Generated Alt Text Review - ${epubTitle}</title>
    <style>
        ${this.getReviewPageStyles()}
    </style>
</head>
<body>
    <div class="container">
        <header class="review-header">
            <h1>AI-Generated Alt Text Review</h1>
            <div class="epub-info">
                <h2>${epubTitle}</h2>
                <p class="review-subtitle">Review AI-generated alternative text for accessibility compliance</p>
                <p class="summary">Found ${analyses.length} image${analyses.length !== 1 ? 's' : ''} with AI-generated alt text</p>
            </div>
        </header>

        <section class="instructions">
            <h2>Review Instructions</h2>
            <div class="instruction-box">
                <p><strong>Please review each AI-generated alt text for:</strong></p>
                <ul>
                    <li><strong>Accuracy:</strong> Does the description match what you see in the image?</li>
                    <li><strong>Relevance:</strong> Is the description relevant to the content context?</li>
                    <li><strong>Brevity:</strong> Is the description concise yet descriptive?</li>
                    <li><strong>Accessibility:</strong> Would this help screen reader users understand the image's purpose?</li>
                </ul>
                <p><em>Note: You may need to manually edit the alt text in your EPUB files based on this review.</em></p>
            </div>
        </section>

        <section class="images-review">
            <h2>Images for Review</h2>
            ${this.generateImageReviewItems(analyses)}
        </section>

        <footer class="review-footer">
            <div class="footer-actions">
                <button class="btn btn-export" onclick="exportReviewData()">📄 Export Review Summary</button>
                <button class="btn btn-help" onclick="showHelp()">❓ Help</button>
            </div>
            <p>Generated on ${new Date().toLocaleString()}</p>
            <p>Total images reviewed: ${analyses.length}</p>
        </footer>
    </div>

    <script>
        ${this.getReviewPageScript()}
    </script>
</body>
</html>`;
    }

    private generateImageReviewItems(analyses: AIImageAnalysis[]): string {
        return analyses.map((analysis, index) => {
            const confidenceClass = this.getConfidenceClass(analysis.confidence);
            const methodBadge = this.getMethodBadge(analysis.analysisMethod);
            
            return `
    <div class="image-review-item" id="image-${index}">
        <div class="image-header">
            <h3>Image ${index + 1}: ${path.basename(analysis.originalSrc)}</h3>
            <div class="image-metadata">
                <span class="method-badge ${analysis.analysisMethod}">${methodBadge}</span>
                <span class="confidence-badge ${confidenceClass}">
                    Confidence: ${Math.round(analysis.confidence * 100)}%
                </span>
                ${analysis.model ? `<span class="model-badge">Model: ${analysis.model}</span>` : ''}
            </div>
        </div>
        
        <div class="image-content">
            <div class="image-display">
                <img src="${analysis.imageData}" alt="Preview of ${analysis.originalSrc}" 
                     class="review-image" loading="lazy" />
                <div class="image-info">
                    <p><strong>Source:</strong> <code>${analysis.originalSrc}</code></p>
                    <p><strong>HTML File:</strong> <code>${path.basename(analysis.htmlFilePath)}</code></p>
                    <p><strong>Image Path:</strong> <code>${analysis.imagePath}</code></p>
                    ${this.generateImageDetails(analysis)}
                </div>
            </div>
            
            <div class="alt-text-review">
                <h4>Generated Alt Text</h4>
                <div class="alt-text-display">
                    <blockquote class="generated-alt-text">"${analysis.generatedAltText}"</blockquote>
                </div>
                
                <div class="review-actions">
                    <div class="copy-buttons">
                        <button class="btn btn-copy-original" onclick="copyToClipboard(${index})">
                            📋 Copy Alt Text
                        </button>
                        <button class="btn btn-edit-text" onclick="enableEditing(${index})">
                            ✏ Edit Alt Text
                        </button>
                    </div>
                    
                    <div class="edit-area" id="edit-area-${index}" style="display: none;">
                        <label for="edited-alt-${index}">Edit Alt Text:</label>
                        <textarea id="edited-alt-${index}" class="edited-alt-input" 
                                  placeholder="Edit the alt text here...">${analysis.generatedAltText}</textarea>
                        <div class="edit-buttons">
                            <button class="btn btn-copy-edited" onclick="copyEditedText(${index})">📋 Copy Edited Text</button>
                            <button class="btn btn-cancel-edit" onclick="cancelEditing(${index})">❌ Cancel</button>
                        </div>
                    </div>
                    
                    <div class="file-instructions">
                        <h5>📝 How to Update Your EPUB:</h5>
                        <ol>
                            <li><strong>Open this HTML file:</strong> <code>${path.basename(analysis.htmlFilePath)}</code></li>
                            <li><strong>Find the image tag:</strong> <code>&lt;img src="${analysis.originalSrc}"</code></li>
                            <li><strong>Add/update the alt attribute:</strong> <code>alt="[paste copied text here]"</code></li>
                            <li><strong>Save the file</strong></li>
                        </ol>
                        <div class="example-code">
                            <strong>Example:</strong><br>
                            <code>&lt;img src="${analysis.originalSrc}" alt="${analysis.generatedAltText}"&gt;</code>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
        }).join('');
    }

    private generateImageDetails(analysis: AIImageAnalysis): string {
        if (!analysis.details) return '';

        const details: string[] = [];
        if (analysis.details.imageSize) {
            details.push(`<strong>Size:</strong> ${this.formatFileSize(analysis.details.imageSize)}`);
        }
        if (analysis.details.imageFormat) {
            details.push(`<strong>Format:</strong> ${analysis.details.imageFormat}`);
        }
        if (analysis.timestamp) {
            details.push(`<strong>Analyzed:</strong> ${new Date(analysis.timestamp).toLocaleString()}`);
        }

        return details.length > 0 ? `<p>${details.join(' | ')}</p>` : '';
    }

    private formatFileSize(bytes: number): string {
        const sizes = ['B', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    private getConfidenceClass(confidence: number): string {
        if (confidence >= 0.8) return 'high';
        if (confidence >= 0.6) return 'medium';
        if (confidence >= 0.4) return 'low';
        return 'very-low';
    }

    private getMethodBadge(method: string): string {
        switch (method) {
            case 'ai': return 'AI Vision';
            case 'ocr': return 'OCR Text';
            case 'metadata': return 'Metadata';
            default: return method.toUpperCase();
        }
    }

    private getReviewPageStyles(): string {
        return `
        * { box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: #f8f9fa; 
            line-height: 1.6; 
            color: #333;
        }
        
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            background: white; 
            border-radius: 8px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
        }
        
        .review-header { 
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); 
            color: white; 
            padding: 30px; 
            border-radius: 8px 8px 0 0; 
        }
        
        .review-header h1 { 
            margin: 0 0 15px 0; 
            font-size: 2.2em; 
        }
        
        .epub-info h2 { 
            margin: 0 0 10px 0; 
            opacity: 0.9; 
            font-size: 1.4em;
        }
        
        .review-subtitle { 
            opacity: 0.8; 
            margin: 5px 0; 
            font-size: 1.1em;
        }
        
        .summary { 
            background: rgba(255,255,255,0.1); 
            padding: 10px 15px; 
            border-radius: 6px; 
            margin-top: 15px;
            font-weight: 500;
        }
        
        .instructions { 
            padding: 30px; 
            border-bottom: 1px solid #e5e7eb; 
        }
        
        .instruction-box { 
            background: #eff6ff; 
            border: 1px solid #bfdbfe; 
            border-radius: 8px; 
            padding: 20px; 
        }
        
        .instruction-box ul { 
            margin: 15px 0; 
            padding-left: 20px; 
        }
        
        .instruction-box li { 
            margin-bottom: 8px; 
        }
        
        .images-review { 
            padding: 30px; 
        }
        
        .image-review-item { 
            border: 1px solid #e5e7eb; 
            border-radius: 12px; 
            margin-bottom: 30px; 
            overflow: hidden;
            transition: all 0.3s ease;
        }
        
        .image-review-item:hover {
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .image-header { 
            background: #f9fafb; 
            padding: 20px; 
            border-bottom: 1px solid #e5e7eb; 
        }
        
        .image-header h3 { 
            margin: 0 0 10px 0; 
            color: #1f2937;
        }
        
        .image-metadata { 
            display: flex; 
            gap: 10px; 
            flex-wrap: wrap; 
        }
        
        .method-badge, .confidence-badge, .model-badge { 
            padding: 4px 10px; 
            border-radius: 20px; 
            font-size: 0.85em; 
            font-weight: 500;
        }
        
        .method-badge.ai { background: #dbeafe; color: #1e40af; }
        .method-badge.ocr { background: #f0fdf4; color: #166534; }
        .method-badge.metadata { background: #fef3c7; color: #92400e; }
        
        .confidence-badge.high { background: #d1fae5; color: #065f46; }
        .confidence-badge.medium { background: #fef3c7; color: #92400e; }
        .confidence-badge.low { background: #fee2e2; color: #991b1b; }
        .confidence-badge.very-low { background: #f3f4f6; color: #6b7280; }
        
        .model-badge { background: #e0e7ff; color: #3730a3; }
        
        .image-content { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 30px; 
            padding: 30px; 
        }
        
        .image-display { 
            display: flex; 
            flex-direction: column; 
            gap: 15px; 
        }
        
        .review-image { 
            max-width: 100%; 
            max-height: 400px; 
            object-fit: contain; 
            border: 1px solid #e5e7eb; 
            border-radius: 8px; 
            background: #f9fafb;
        }
        
        .image-info { 
            font-size: 0.9em; 
            color: #6b7280; 
        }
        
        .image-info code { 
            background: #f3f4f6; 
            padding: 2px 6px; 
            border-radius: 4px; 
            font-family: 'SF Mono', Monaco, monospace;
            word-break: break-all;
        }
        
        .alt-text-review h4 { 
            margin: 0 0 15px 0; 
            color: #1f2937;
        }
        
        .generated-alt-text { 
            background: #f8fafc; 
            border-left: 4px solid #3b82f6; 
            margin: 0; 
            padding: 15px 20px; 
            font-style: normal; 
            border-radius: 0 8px 8px 0;
            color: #1e293b;
        }
        
        .review-actions { 
            margin-top: 20px; 
        }
        
        .copy-buttons { 
            display: flex; 
            gap: 10px; 
            margin-bottom: 15px; 
        }
        
        .btn { 
            padding: 8px 16px; 
            border: none; 
            border-radius: 6px; 
            cursor: pointer; 
            font-weight: 500; 
            transition: all 0.2s ease;
        }
        
        .btn:hover { 
            transform: translateY(-1px); 
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        
        .btn-copy-original { background: #6b7280; color: white; }
        .btn-edit-text { background: #4f46e5; color: white; }
        .btn-copy-edited { background: #059669; color: white; }
        .btn-cancel-edit { background: #ef4444; color: white; }
        
        .edit-buttons {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }
        
        .file-instructions {
            background: #f0f9ff;
            border: 1px solid #bae6fd;
            border-radius: 6px;
            padding: 15px;
            margin-top: 20px;
        }
        
        .file-instructions h5 {
            margin: 0 0 10px 0;
            color: #0c4a6e;
        }
        
        .file-instructions ol {
            margin: 10px 0;
            padding-left: 20px;
        }
        
        .file-instructions li {
            margin-bottom: 5px;
        }
        
        .example-code {
            background: #e0f2fe;
            border-radius: 4px;
            padding: 10px;
            margin-top: 10px;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 0.9em;
        }
        
        .edit-area { 
            background: #f8fafc; 
            border: 1px solid #e2e8f0; 
            border-radius: 8px; 
            padding: 15px; 
            margin-top: 15px;
        }
        
        .edit-area label { 
            display: block; 
            margin-bottom: 5px; 
            font-weight: 500; 
        }
        
        .edited-alt-input { 
            width: 100%; 
            padding: 10px; 
            border: 1px solid #d1d5db; 
            border-radius: 6px; 
            resize: vertical; 
            min-height: 80px;
            font-family: inherit;
        }
        
        .footer-actions {
            display: flex;
            gap: 15px;
            justify-content: center;
            margin-bottom: 15px;
        }
        
        .btn-export { background: #4f46e5; color: white; }
        .btn-help { background: #6b7280; color: white; }
        
        .review-footer { 
            padding: 20px 30px; 
            background: #f9fafb; 
            border-top: 1px solid #e5e7eb; 
            text-align: center; 
            color: #6b7280; 
            font-size: 0.9em; 
        }
        
        .review-footer p { 
            margin: 5px 0; 
        }
        
        @media (max-width: 768px) {
            .image-content { 
                grid-template-columns: 1fr; 
                gap: 20px; 
            }
            
            .copy-buttons { 
                flex-direction: column; 
            }
            
            .image-metadata { 
                flex-direction: column; 
                align-items: flex-start; 
            }
        }
    `;
    }

    private getReviewPageScript(): string {
        return `
        // Review tracking for export
        const reviewData = {};
        const allAnalyses = [];
        
        // Store analysis data for export
        document.addEventListener('DOMContentLoaded', function() {
            // Extract analysis data from the page
            document.querySelectorAll('.image-review-item').forEach((item, index) => {
                const originalSrc = item.querySelector('.image-info code').textContent;
                const altText = item.querySelector('.generated-alt-text').textContent.replace(/"/g, '');
                allAnalyses[index] = { originalSrc, altText };
            });
        });
        
        function copyToClipboard(imageIndex) {
            const altText = document.querySelector('#image-' + imageIndex + ' .generated-alt-text').textContent.replace(/"/g, '');
            navigator.clipboard.writeText(altText).then(() => {
                showToast('Alt text copied to clipboard!');
            }).catch(() => {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = altText;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                showToast('Alt text copied to clipboard!');
            });
        }
        
        function copyEditedText(imageIndex) {
            const editedText = document.getElementById('edited-alt-' + imageIndex).value;
            if (!editedText.trim()) {
                showToast('No edited text to copy', 'warning');
                return;
            }
            
            navigator.clipboard.writeText(editedText).then(() => {
                showToast('Edited alt text copied to clipboard!');
            }).catch(() => {
                const textArea = document.createElement('textarea');
                textArea.value = editedText;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                showToast('Edited alt text copied to clipboard!');
            });
        }
        
        function enableEditing(imageIndex) {
            const editArea = document.getElementById('edit-area-' + imageIndex);
            editArea.style.display = editArea.style.display === 'none' ? 'block' : 'none';
        }
        
        function cancelEditing(imageIndex) {
            const editArea = document.getElementById('edit-area-' + imageIndex);
            editArea.style.display = 'none';
            // Reset the textarea to original text
            const originalText = document.querySelector('#image-' + imageIndex + ' .generated-alt-text').textContent.replace(/"/g, '');
            document.getElementById('edited-alt-' + imageIndex).value = originalText;
        }
        
        function showToast(message, type = 'success') {
            // Create toast notification
            const toast = document.createElement('div');
            const bgColor = type === 'success' ? '#10b981' : '#f59e0b';
            toast.style.cssText = 'position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 6px; color: white; font-weight: 500; z-index: 10000; transition: all 0.3s ease; background: ' + bgColor;
            toast.textContent = message;
            document.body.appendChild(toast);
            
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => document.body.removeChild(toast), 300);
            }, 3000);
        }
        
        // Add export functionality
        function exportReviewData() {
            const exportData = {
                epubTitle: document.querySelector('.epub-info h2').textContent,
                generatedAt: new Date().toISOString(),
                images: allAnalyses.map((analysis, index) => ({
                    ...analysis,
                    review: reviewData[index] || { action: 'not-reviewed' }
                }))
            };
            
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'alt-text-review-summary.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showToast('Review summary exported!');
        }
        
        function showHelp() {
            const helpText = '' +
                '<h3>How to Use This Review Page</h3>' +
                '<div style="text-align: left; line-height: 1.6;">' +
                '<h4>📋 Copy Functions:</h4>' +
                '<ul>' +
                '<li><strong>Copy Alt Text:</strong> Copy the AI-generated alt text to your clipboard</li>' +
                '<li><strong>Edit Alt Text:</strong> Open an editor to modify the text, then copy the revised version</li>' +
                '</ul>' +
                '<h4>📦 How to Update Your EPUB:</h4>' +
                '<ol>' +
                '<li>Copy the alt text (original or your edited version)</li>' +
                '<li>Open the HTML file shown in the instructions</li>' +
                '<li>Find the &lt;img&gt; tag with the corresponding src attribute</li>' +
                '<li>Add or update the alt="..." attribute with your copied text</li>' +
                '<li>Save the HTML file</li>' +
                '</ol>' +
                '<h4>💡 Tips:</h4>' +
                '<ul>' +
                '<li>Review each description for accuracy and helpfulness</li>' +
                '<li>Edit text that is too long, too short, or inaccurate</li>' +
                '<li>Focus on what screen reader users need to know</li>' +
                '</ul>' +
                '<h4>📄 Export:</h4>' +
                '<p>Use "Export Review Summary" to save a JSON file with all the image data for documentation.</p>' +
                '</div>';
            
            const modal = document.createElement('div');
            modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10001;';
            
            const helpBox = document.createElement('div');
            helpBox.style.cssText = 'background: white; padding: 30px; border-radius: 8px; max-width: 600px; max-height: 80vh; overflow-y: auto; position: relative;';
            
            helpBox.innerHTML = helpText + '<button onclick="this.closest(' + "'" + '[style*="fixed"]' + "'" + ').remove()" style="position: absolute; top: 15px; right: 15px; background: #ef4444; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer;">✕ Close</button>';
            
            modal.appendChild(helpBox);
            document.body.appendChild(modal);
        }
        
        // Add keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            if (e.ctrlKey || e.metaKey) {
                switch(e.key) {
                    case 's':
                        e.preventDefault();
                        exportReviewData();
                        break;
                }
            }
        });
    `;
    }
}