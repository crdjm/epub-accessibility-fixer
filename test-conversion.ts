import { Epub2To3Converter } from './src/core/epub2-to-3-converter';
import { Logger } from './src/utils/common';
import * as path from 'path';
import * as fs from 'fs-extra';

async function testConversion() {
    const inputPath = "/Volumes/David's 1TB/work/from_desktop/epubs/img.epub";
    const outputPath = path.join(__dirname, 'test-output-fixed.epub');
    
    // Create a simple logger
    const logger = new Logger(true);
    
    try {
        console.log('Starting EPUB 2 to 3 conversion test...');
        
        // Convert the EPUB
        const converter = new Epub2To3Converter(logger);
        const result = await converter.convertEpub2To3(inputPath, outputPath);
        
        if (result.success) {
            console.log('✅ Conversion successful!');
            console.log('Changes made:');
            result.changes.forEach(change => console.log(`  • ${change}`));
            
            if (result.warnings.length > 0) {
                console.log('Warnings:');
                result.warnings.forEach(warning => console.log(`  ⚠️  ${warning}`));
            }
            
            // Check if output file exists
            if (await fs.pathExists(outputPath)) {
                const stats = await fs.stat(outputPath);
                console.log(`Output file size: ${stats.size} bytes`);
                console.log(`Output file: ${outputPath}`);
            }
        } else {
            console.log('❌ Conversion failed!');
            result.errors.forEach(error => console.log(`  • ${error}`));
        }
    } catch (error) {
        console.error('Error during conversion:', error);
    }
}

testConversion();