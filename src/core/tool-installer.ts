import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import * as tar from 'tar';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../utils/common';
import * as yauzl from 'yauzl';

const execAsync = promisify(exec);

export interface ToolInfo {
    name: string;
    version: string;
    downloadUrl: string;
    executable: string;
    installed: boolean;
    path?: string;
}

export class ExternalToolInstaller {
    private logger: Logger;
    private toolsDir: string;

    constructor(logger: Logger) {
        this.logger = logger;
        this.toolsDir = path.join(__dirname, '..', '..', 'tools');
    }

    async initializeToolsDirectory(): Promise<void> {
        await fs.ensureDir(this.toolsDir);
    }

    async getEpubCheckInfo(): Promise<ToolInfo> {
        const platform = os.platform();
        const version = '5.1.0'; // Latest stable version

        return {
            name: 'epubcheck',
            version,
            downloadUrl: `https://github.com/w3c/epubcheck/releases/download/v${version}/epubcheck-${version}.zip`,
            executable: 'epubcheck.jar', // EpubCheck 5.x uses JAR files
            installed: false
        };
    }

    async getDaisyAceInfo(): Promise<ToolInfo> {
        return {
            name: 'daisy-ace',
            version: 'latest',
            downloadUrl: 'npm:@daisy/ace',
            executable: 'ace',
            installed: false
        };
    }

    async checkToolInstallation(tool: ToolInfo): Promise<boolean> {
        try {
            const toolPath = path.join(this.toolsDir, tool.name);

            if (tool.name === 'epubcheck') {
                const execPath = path.join(toolPath, 'epubcheck-' + tool.version, tool.executable);
                const exists = await fs.pathExists(execPath);
                if (exists) {
                    tool.path = execPath;
                    tool.installed = true;
                    return true;
                }
            } else if (tool.name === 'daisy-ace') {
                // Check if ace is available in global npm
                try {
                    await execAsync('npm list -g @daisy/ace');
                    tool.installed = true;
                    tool.path = 'ace'; // Global command
                    return true;
                } catch {
                    // Check local installation
                    const localPath = path.join(toolPath, 'node_modules', '.bin', 'ace');
                    const exists = await fs.pathExists(localPath);
                    if (exists) {
                        tool.path = localPath;
                        tool.installed = true;
                        return true;
                    }
                }
            }
            return false;
        } catch (error) {
            this.logger.warn(`Error checking ${tool.name} installation: ${error}`);
            return false;
        }
    }

    async installEpubCheck(tool: ToolInfo): Promise<boolean> {
        try {
            this.logger.info(`Installing ${tool.name} v${tool.version}...`);

            const toolPath = path.join(this.toolsDir, tool.name);
            await fs.ensureDir(toolPath);

            // Download the ZIP file
            const zipPath = path.join(toolPath, 'epubcheck.zip');
            const response = await axios({
                method: 'GET',
                url: tool.downloadUrl,
                responseType: 'stream'
            });

            const writer = fs.createWriteStream(zipPath);
            response.data.pipe(writer);

            await new Promise<void>((resolve, reject) => {
                writer.on('finish', () => resolve());
                writer.on('error', reject);
            });

            // Extract the ZIP file using yauzl
            await this.extractZipFile(zipPath, toolPath);

            // Clean up ZIP file
            await fs.remove(zipPath);

            // Verify installation
            const execPath = path.join(toolPath, `epubcheck-${tool.version}`, tool.executable);
            const exists = await fs.pathExists(execPath);

            if (exists) {
                // Make executable on Unix systems
                if (os.platform() !== 'win32') {
                    await fs.chmod(execPath, '755');
                }

                tool.path = execPath;
                tool.installed = true;
                this.logger.success(`Successfully installed ${tool.name}`);
                return true;
            } else {
                // Try to list what was actually extracted to help debug
                try {
                    const extractedFiles = await fs.readdir(toolPath);
                    this.logger.warn(`Expected file not found. Extracted files: ${extractedFiles.join(', ')}`);

                    // Check if there's a differently named directory
                    for (const file of extractedFiles) {
                        const filePath = path.join(toolPath, file);
                        const stat = await fs.stat(filePath);
                        if (stat.isDirectory() && file.startsWith('epubcheck')) {
                            const altExecPath = path.join(filePath, tool.executable);
                            if (await fs.pathExists(altExecPath)) {
                                if (os.platform() !== 'win32') {
                                    await fs.chmod(altExecPath, '755');
                                }
                                tool.path = altExecPath;
                                tool.installed = true;
                                this.logger.success(`Successfully installed ${tool.name} (found in ${file})`);
                                return true;
                            }
                        }
                    }
                } catch (listError) {
                    this.logger.warn(`Could not list extracted files: ${listError}`);
                }

                throw new Error(`Installation verification failed: ${execPath} not found`);
            }
        } catch (error) {
            this.logger.error(`Failed to install ${tool.name}: ${error}`);
            return false;
        }
    }

    async installDaisyAce(tool: ToolInfo): Promise<boolean> {
        try {
            this.logger.info(`Installing ${tool.name}...`);

            const toolPath = path.join(this.toolsDir, tool.name);
            await fs.ensureDir(toolPath);

            // Create package.json for local installation
            const packageJson = {
                name: 'daisy-ace-local',
                version: '1.0.0',
                dependencies: {
                    '@daisy/ace': 'latest'
                }
            };

            await fs.writeJson(path.join(toolPath, 'package.json'), packageJson);

            // Install via npm
            await execAsync('npm install', { cwd: toolPath });

            // Verify installation
            const execPath = path.join(toolPath, 'node_modules', '.bin', 'ace');
            const exists = await fs.pathExists(execPath);

            if (exists) {
                tool.path = execPath;
                tool.installed = true;
                this.logger.success(`Successfully installed ${tool.name}`);
                return true;
            } else {
                throw new Error('Installation verification failed');
            }
        } catch (error) {
            this.logger.error(`Failed to install ${tool.name}: ${error}`);
            return false;
        }
    }

    async installAllTools(): Promise<{ epubcheck: ToolInfo; daisyAce: ToolInfo }> {
        await this.initializeToolsDirectory();

        const epubcheck = await this.getEpubCheckInfo();
        const daisyAce = await this.getDaisyAceInfo();

        // Check existing installations
        await this.checkToolInstallation(epubcheck);
        await this.checkToolInstallation(daisyAce);

        // Install missing tools
        if (!epubcheck.installed) {
            await this.installEpubCheck(epubcheck);
        } else {
            this.logger.info(`${epubcheck.name} is already installed`);
        }

        if (!daisyAce.installed) {
            await this.installDaisyAce(daisyAce);
        } else {
            this.logger.info(`${daisyAce.name} is already installed`);
        }

        return { epubcheck, daisyAce };
    }

    private async extractZipFile(zipPath: string, extractPath: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
                if (err) {
                    reject(err);
                    return;
                }

                zipfile.readEntry();
                zipfile.on('entry', async (entry) => {
                    if (/\/$/.test(entry.fileName)) {
                        // Directory entry
                        const dirPath = path.join(extractPath, entry.fileName);
                        await fs.ensureDir(dirPath);
                        zipfile.readEntry();
                    } else {
                        // File entry
                        const filePath = path.join(extractPath, entry.fileName);
                        await fs.ensureDir(path.dirname(filePath));

                        zipfile.openReadStream(entry, (err, readStream) => {
                            if (err) {
                                reject(err);
                                return;
                            }

                            const writeStream = fs.createWriteStream(filePath);
                            readStream.pipe(writeStream);
                            writeStream.on('close', () => {
                                zipfile.readEntry();
                            });
                            writeStream.on('error', reject);
                        });
                    }
                });

                zipfile.on('end', () => {
                    resolve();
                });

                zipfile.on('error', reject);
            });
        });
    }
    async verifyJavaInstallation(): Promise<boolean> {
        try {
            // Try to run java -version and capture stderr (Java outputs version to stderr)
            const { stdout, stderr } = await execAsync('java -version 2>&1');
            const output = stdout + stderr;

            if (output.includes('java version') || output.includes('openjdk version')) {
                this.logger.info(`Java is available: ${output.split('\n')[0].trim()}`);
                return true;
            } else {
                throw new Error('Java version not detected in output');
            }
        } catch (error) {
            this.logger.error('Java is required for epubcheck but not found. Please install Java 8 or later.');
            this.logger.info('You can install Java from: https://adoptopenjdk.net/ or use your system package manager');
            return false;
        }
    }

    async verifyNodeInstallation(): Promise<boolean> {
        try {
            const { stdout } = await execAsync('node --version');
            this.logger.info(`Node.js is available: ${stdout.trim()}`);
            return true;
        } catch (error) {
            this.logger.error('Node.js is required but not found.');
            return false;
        }
    }

    async verifySystemRequirements(): Promise<boolean> {
        const javaAvailable = await this.verifyJavaInstallation();
        const nodeAvailable = await this.verifyNodeInstallation();

        return javaAvailable && nodeAvailable;
    }
}