import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';

export class Logger {
    private verbose: boolean;
    private logs: string[] = [];

    constructor(verbose: boolean = false) {
        this.verbose = verbose;
    }

    isVerbose(): boolean {
        return this.verbose;
    }

    info(message: string): void {
        const logMessage = `[INFO] ${new Date().toISOString()} - ${message}`;
        this.logs.push(logMessage);
        if (this.verbose) {
            console.log(chalk.blue(logMessage));
        }
    }

    warn(message: string): void {
        const logMessage = `[WARN] ${new Date().toISOString()} - ${message}`;
        this.logs.push(logMessage);
        console.log(chalk.yellow(logMessage));
    }

    error(message: string): void {
        const logMessage = `[ERROR] ${new Date().toISOString()} - ${message}`;
        this.logs.push(logMessage);
        console.log(chalk.red(logMessage));
    }

    success(message: string): void {
        const logMessage = `[SUCCESS] ${new Date().toISOString()} - ${message}`;
        this.logs.push(logMessage);
        console.log(chalk.green(logMessage));
    }

    getLogs(): string[] {
        return [...this.logs];
    }

    async saveLogs(filePath: string): Promise<void> {
        await fs.writeFile(filePath, this.logs.join('\n'), 'utf8');
    }
}

export async function ensureDir(dirPath: string): Promise<void> {
    await fs.ensureDir(dirPath);
}

export async function cleanupTemp(tempDir: string): Promise<void> {
    try {
        await fs.remove(tempDir);
    } catch (error) {
        // Ignore cleanup errors
    }
}

export function sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-z0-9.-]/gi, '_');
}

export function generateTempDir(): string {
    const tmpDir = require('os').tmpdir();
    return path.join(tmpDir, `epub-fix-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
}

export async function copyFile(src: string, dest: string): Promise<void> {
    await fs.copy(src, dest);
}

export function isValidEpubPath(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.epub' && fs.existsSync(filePath);
}

export function formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}