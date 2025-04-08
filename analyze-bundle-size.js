#!/usr/bin/env node
/**
 * Production Bundle Size Analysis Script (Module 3)
 * 
 * This script analyzes the final production bundle to identify:
 * 1. The total size of JavaScript, CSS, and assets
 * 2. The largest individual chunks
 * 3. Opportunities for further optimization
 * 
 * Usage:
 *   node analyze-bundle-size.js
 * 
 * Note: Run this after building the production bundle with npm run build
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Configuration
const DIST_DIR = './dist/public';
const REPORT_FILE = './bundle-size-report.md';

// Size thresholds in bytes
const SIZE_THRESHOLDS = {
  SMALL: 10 * 1024, // 10 KB
  MEDIUM: 50 * 1024, // 50 KB
  LARGE: 250 * 1024, // 250 KB
  HUGE: 1024 * 1024, // 1 MB
};

// Common chunk types
const CHUNK_TYPES = [
  { ext: '.js', description: 'JavaScript' },
  { ext: '.css', description: 'CSS' },
  { ext: '.map', description: 'Source maps' },
  { ext: '.html', description: 'HTML' },
  { ext: '.svg', description: 'SVG images' },
  { ext: '.png', description: 'PNG images' },
  { ext: '.jpg', description: 'JPEG images' },
  { ext: '.woff2', description: 'Web fonts (WOFF2)' },
  { ext: '.woff', description: 'Web fonts (WOFF)' },
];

// Format bytes to human-readable size
function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// Get the size of a file in bytes
function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (err) {
    console.error(`Error getting size of ${filePath}:`, err.message);
    return 0;
  }
}

// Check if the distribution directory exists
function checkDistDir() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`Error: Distribution directory not found at ${DIST_DIR}`);
    console.error('Please run npm run build first');
    process.exit(1);
  }
}

// Get all files in the distribution directory
function getDistFiles(dir = DIST_DIR) {
  const files = [];
  
  function scanDir(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  
  scanDir(dir);
  return files;
}

// Group files by extension
function groupFilesByType(files) {
  const groups = {};
  
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    
    if (!groups[ext]) {
      groups[ext] = [];
    }
    
    groups[ext].push(file);
  }
  
  return groups;
}

// Analyze chunk naming patterns to identify libraries
function analyzeChunkNames(files) {
  const jsFiles = files.filter(file => file.endsWith('.js'));
  const patterns = {};
  
  for (const file of jsFiles) {
    const fileName = path.basename(file);
    
    // Check for common patterns like vendor, chunk names
    if (fileName.includes('vendor')) {
      patterns.vendor = (patterns.vendor || 0) + 1;
    }
    
    // Check for chunk hash patterns (numbers and letters after a dot or dash)
    const hashMatch = fileName.match(/[-_.][a-f0-9]{7,}/i);
    if (hashMatch) {
      patterns.hashed = (patterns.hashed || 0) + 1;
    }
  }
  
  return patterns;
}

// Generate recommendations based on analysis
function generateRecommendations(files, filesByType) {
  const recommendations = [];
  
  // Total JS size
  const jsFiles = filesByType['.js'] || [];
  const totalJsSize = jsFiles.reduce((sum, file) => sum + getFileSize(file), 0);
  
  // Check for large individual JS files
  const largeJsFiles = jsFiles
    .map(file => ({
      path: file,
      size: getFileSize(file),
      name: path.basename(file)
    }))
    .filter(file => file.size > SIZE_THRESHOLDS.LARGE)
    .sort((a, b) => b.size - a.size);
  
  if (largeJsFiles.length > 0) {
    recommendations.push('Large JavaScript chunks detected:');
    largeJsFiles.forEach(file => {
      recommendations.push(`- ${file.name}: ${formatSize(file.size)}`);
    });
    recommendations.push('Consider using dynamic imports or code splitting to reduce initial load time.');
  }
  
  // Check for source maps in production
  if (filesByType['.map'] && filesByType['.map'].length > 0) {
    recommendations.push('Source maps are included in the production build:');
    recommendations.push(`- ${filesByType['.map'].length} source map files found`);
    recommendations.push('- Consider removing source maps for production builds to reduce size');
  }
  
  // Check for uncompressed images
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif'];
  const imageFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return imageExtensions.includes(ext);
  });
  
  if (imageFiles.length > 0) {
    const totalImageSize = imageFiles.reduce((sum, file) => sum + getFileSize(file), 0);
    if (totalImageSize > SIZE_THRESHOLDS.LARGE) {
      recommendations.push('Large image assets detected:');
      recommendations.push(`- Total image size: ${formatSize(totalImageSize)}`);
      recommendations.push('- Consider using WebP format and optimizing images');
    }
  }
  
  // Check for multiple CSS files
  const cssFiles = filesByType['.css'] || [];
  if (cssFiles.length > 1) {
    recommendations.push('Multiple CSS files detected:');
    recommendations.push(`- ${cssFiles.length} CSS files found`);
    recommendations.push('- Consider combining CSS files to reduce HTTP requests');
  }
  
  return recommendations;
}

// Generate a summary report
function generateReport(files, filesByType) {
  const totalSize = files.reduce((sum, file) => sum + getFileSize(file), 0);
  const report = [];
  
  report.push('# Production Bundle Size Analysis');
  report.push(`\nAnalysis date: ${new Date().toLocaleString()}`);
  report.push(`\n## Overall Summary`);
  report.push(`\nTotal distribution size: **${formatSize(totalSize)}**`);
  report.push(`Total files: **${files.length}**`);
  
  // Size by file type
  report.push('\n## File Types Breakdown');
  report.push('\n| Type | Count | Size | % of Total |');
  report.push('|------|-------|------|------------|');
  
  for (const type of CHUNK_TYPES) {
    const typeFiles = filesByType[type.ext] || [];
    const typeSize = typeFiles.reduce((sum, file) => sum + getFileSize(file), 0);
    const percentage = totalSize > 0 ? (typeSize / totalSize * 100).toFixed(2) : '0.00';
    
    report.push(`| ${type.description} | ${typeFiles.length} | ${formatSize(typeSize)} | ${percentage}% |`);
  }
  
  // Largest files
  report.push('\n## Largest Files');
  report.push('\n| File | Size | Type |');
  report.push('|------|------|------|');
  
  const largestFiles = files
    .map(file => ({
      path: file,
      size: getFileSize(file),
      name: path.relative(DIST_DIR, file),
      ext: path.extname(file).toLowerCase()
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 10);
  
  for (const file of largestFiles) {
    const typeInfo = CHUNK_TYPES.find(t => t.ext === file.ext) || { description: 'Unknown' };
    report.push(`| ${file.name} | ${formatSize(file.size)} | ${typeInfo.description} |`);
  }
  
  // Recommendations
  const recommendations = generateRecommendations(files, filesByType);
  if (recommendations.length > 0) {
    report.push('\n## Optimization Recommendations');
    report.push('');
    recommendations.forEach(rec => report.push(rec));
  }
  
  // Library detection
  report.push('\n## Chunk Analysis');
  const chunkPatterns = analyzeChunkNames(files);
  report.push('\nChunk naming patterns detected:');
  for (const [pattern, count] of Object.entries(chunkPatterns)) {
    report.push(`- ${pattern}: ${count} files`);
  }
  
  return report.join('\n');
}

// Main function
function main() {
  console.log('Production Bundle Size Analysis');
  console.log('------------------------------');
  
  // Check if the dist directory exists
  checkDistDir();
  
  // Get all files in the dist directory
  console.log(`Scanning distribution directory: ${DIST_DIR}`);
  const files = getDistFiles();
  console.log(`Found ${files.length} files`);
  
  // Group files by type
  const filesByType = groupFilesByType(files);
  
  // Generate the report
  console.log('Analyzing bundle size...');
  const report = generateReport(files, filesByType);
  
  // Write the report to a file
  fs.writeFileSync(REPORT_FILE, report);
  console.log(`Report written to ${REPORT_FILE}`);
  
  // Print a summary to the console
  const totalSize = files.reduce((sum, file) => sum + getFileSize(file), 0);
  console.log(`\nTotal bundle size: ${formatSize(totalSize)}`);
  
  // Print size by file type
  console.log('\nBreakdown by file type:');
  for (const type of CHUNK_TYPES) {
    const typeFiles = filesByType[type.ext] || [];
    if (typeFiles.length > 0) {
      const typeSize = typeFiles.reduce((sum, file) => sum + getFileSize(file), 0);
      console.log(`- ${type.description}: ${formatSize(typeSize)} (${typeFiles.length} files)`);
    }
  }
  
  console.log(`\nSee ${REPORT_FILE} for full analysis`);
}

// Run the main function
main();