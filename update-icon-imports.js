/**
 * Icon Import Optimization Script (Module 2)
 * 
 * This script optimizes the codebase by:
 * 1. Scanning all TypeScript/TSX files for imported lucide icons
 * 2. Replacing bulk imports with individual imports to enable tree-shaking
 * 3. Creating backup files to enable safe rollback if needed
 * 4. Generating a report of icon usage across the app
 * 
 * Usage:
 * $ node update-icon-imports.js [--analyze] [--apply]
 * 
 * Options:
 *   --analyze   Only analyze icon usage, don't modify files
 *   --apply     Apply the changes (without this flag, runs in dry-run mode)
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

// Expanded map of lucide icon names to their file paths (includes all icons found in our codebase)
const iconNameToPath = {
  'Activity': 'activity',
  'AlertCircle': 'alert-circle',
  'AlertOctagon': 'alert-octagon',
  'AlertTriangle': 'alert-triangle',
  'AlignCenter': 'align-center',
  'AlignJustify': 'align-justify',
  'AlignLeft': 'align-left',
  'AlignRight': 'align-right',
  'ArrowDown': 'arrow-down',
  'ArrowLeft': 'arrow-left',
  'ArrowRight': 'arrow-right',
  'ArrowUp': 'arrow-up',
  'BarChart': 'bar-chart',
  'BarChart2': 'bar-chart-2',
  'BarChart3': 'bar-chart-3',
  'Bell': 'bell',
  'BellRing': 'bell-ring',
  'Bold': 'bold',
  'Book': 'book',
  'BookOpen': 'book-open',
  'Bookmark': 'bookmark',
  'Box': 'box',
  'Calendar': 'calendar',
  'Check': 'check',
  'CheckCircle': 'check-circle',
  'CheckSquare': 'check-square',
  'ChevronDown': 'chevron-down',
  'ChevronLeft': 'chevron-left',
  'ChevronRight': 'chevron-right',
  'ChevronUp': 'chevron-up',
  'ChevronsDown': 'chevrons-down',
  'ChevronsLeft': 'chevrons-left',
  'ChevronsRight': 'chevrons-right',
  'ChevronsUp': 'chevrons-up',
  'Circle': 'circle',
  'Clipboard': 'clipboard',
  'Clock': 'clock',
  'Copy': 'copy',
  'CreditCard': 'credit-card',
  'Dot': 'dot',
  'Download': 'download',
  'Edit': 'edit',
  'Edit2': 'edit-2',
  'ExternalLink': 'external-link',
  'Eye': 'eye',
  'EyeOff': 'eye-off',
  'File': 'file',
  'FileText': 'file-text',
  'Filter': 'filter',
  'Flag': 'flag',
  'Folder': 'folder',
  'FolderPlus': 'folder-plus',
  'GitBranch': 'git-branch',
  'GitBranchPlus': 'git-branch-plus',
  'GitCommit': 'git-commit',
  'GitMerge': 'git-merge',
  'GitPullRequest': 'git-pull-request',
  'Globe': 'globe',
  'GripVertical': 'grip-vertical',
  'HardDrive': 'hard-drive',
  'Hash': 'hash',
  'Heart': 'heart',
  'HelpCircle': 'help-circle',
  'Home': 'home',
  'Image': 'image',
  'Info': 'info',
  'Italic': 'italic',
  'Languages': 'languages',
  'Layers': 'layers',
  'Layout': 'layout',
  'Link': 'link',
  'Link2': 'link-2',
  'List': 'list',
  'Loader': 'loader',
  'Lock': 'lock',
  'LogIn': 'log-in',
  'LogOut': 'log-out',
  'Mail': 'mail',
  'Map': 'map',
  'MapPin': 'map-pin',
  'Maximize': 'maximize',
  'Maximize2': 'maximize-2',
  'Menu': 'menu',
  'MessageCircle': 'message-circle',
  'MessageSquare': 'message-square',
  'Minimize': 'minimize',
  'Minimize2': 'minimize-2',
  'Minus': 'minus',
  'MinusCircle': 'minus-circle',
  'MinusSquare': 'minus-square',
  'Monitor': 'monitor',
  'Moon': 'moon',
  'MoreHorizontal': 'more-horizontal',
  'MoreVertical': 'more-vertical',
  'Move': 'move',
  'Music': 'music',
  'PanelLeft': 'panel-left',
  'PanelRight': 'panel-right',
  'Paperclip': 'paperclip',
  'Pause': 'pause',
  'Pencil': 'pencil',
  'Play': 'play',
  'Plus': 'plus',
  'PlusCircle': 'plus-circle',
  'PlusSquare': 'plus-square',
  'Printer': 'printer',
  'Radio': 'radio',
  'RefreshCw': 'refresh-cw',
  'Save': 'save',
  'Search': 'search',
  'Send': 'send',
  'Settings': 'settings',
  'Share': 'share',
  'Share2': 'share-2',
  'Shield': 'shield',
  'ShieldOff': 'shield-off',
  'Sidebar': 'sidebar',
  'Slash': 'slash',
  'Sliders': 'sliders',
  'Smartphone': 'smartphone',
  'Square': 'square',
  'Star': 'star',
  'Sun': 'sun',
  'Table': 'table',
  'Tag': 'tag',
  'Terminal': 'terminal',
  'Thermometer': 'thermometer',
  'ThumbsDown': 'thumbs-down',
  'ThumbsUp': 'thumbs-up',
  'Toggle': 'toggle',
  'ToggleLeft': 'toggle-left',
  'ToggleRight': 'toggle-right',
  'Trash': 'trash',
  'Trash2': 'trash-2',
  'Underline': 'underline',
  'Upload': 'upload',
  'User': 'user',
  'UserPlus': 'user-plus',
  'Users': 'users',
  'Video': 'video',
  'Waves': 'waves',
  'Wifi': 'wifi',
  'WifiOff': 'wifi-off',
  'X': 'x',
  'XCircle': 'x-circle',
  'XSquare': 'x-square',
  'ZapOff': 'zap-off',
  'ZoomIn': 'zoom-in',
  'ZoomOut': 'zoom-out'
};

// Parse command line arguments
const args = process.argv.slice(2);
const analyzeOnly = args.includes('--analyze');
const applyChanges = args.includes('--apply');

// Create backup directory if it doesn't exist
const backupDir = path.join(process.cwd(), 'icon-backup');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

// Statistics tracking
const stats = {
  filesScanned: 0,
  filesModified: 0,
  totalIcons: 0,
  iconUsage: {},
  errors: []
};

async function main() {
  try {
    console.log('🔍 Scanning for icon imports...');
    
    // Find all TypeScript and TSX files
    const files = await glob('client/src/**/*.{ts,tsx}');
    stats.filesScanned = files.length;
    
    // Process each file
    for (const file of files) {
      await processFile(file);
    }
    
    // Generate report
    generateReport();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

async function processFile(file) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    
    // Find imports from lucide-react
    const importRegex = /import\s+{([^}]+)}\s+from\s+["']lucide-react["']/g;
    let match;
    let newContent = content;
    let fileModified = false;
    let iconsInFile = [];
    
    while ((match = importRegex.exec(content)) !== null) {
      const iconsList = match[1];
      // Get individual icon names
      const icons = iconsList.split(',').map(icon => icon.trim());
      iconsInFile = [...iconsInFile, ...icons];
      
      // Update usage statistics
      icons.forEach(icon => {
        stats.totalIcons++;
        if (!stats.iconUsage[icon]) {
          stats.iconUsage[icon] = 0;
        }
        stats.iconUsage[icon]++;
      });
      
      // If we're only analyzing, don't modify the file
      if (analyzeOnly) continue;
      
      // Create individual imports
      const newImports = icons
        .filter(icon => Object.keys(iconNameToPath).includes(icon))
        .map(icon => `import ${icon} from "lucide-react/dist/esm/icons/${iconNameToPath[icon]}";`)
        .join('\n');
      
      // Replace the old import with the new imports
      if (newImports) {
        newContent = newContent.replace(match[0], newImports);
        fileModified = true;
      }
    }
    
    // If we found icons and not in analyze-only mode
    if (fileModified && !analyzeOnly) {
      if (applyChanges) {
        // Backup the file first
        const filename = path.basename(file);
        const backupPath = path.join(backupDir, `${filename}.bak`);
        fs.writeFileSync(backupPath, content, 'utf8');
        
        // Write the modified content back to the file
        fs.writeFileSync(file, newContent, 'utf8');
        console.log(`✅ Updated imports in ${file} (backup created)`);
        stats.filesModified++;
      } else {
        console.log(`🔍 Would update ${file} (dry run)`);
        console.log(`   Icons found: ${iconsInFile.join(', ')}`);
      }
    }
  } catch (error) {
    stats.errors.push({ file, error: error.message });
    console.error(`❌ Error processing ${file}: ${error.message}`);
  }
}

function generateReport() {
  console.log('\n📊 Icon Import Analysis Report');
  console.log('============================');
  console.log(`Files scanned: ${stats.filesScanned}`);
  
  if (!analyzeOnly && applyChanges) {
    console.log(`Files modified: ${stats.filesModified}`);
  } else if (!analyzeOnly) {
    console.log(`Files that would be modified: ${stats.filesModified} (dry run)`);
  }
  
  console.log(`Total icons used: ${stats.totalIcons}`);
  console.log(`Unique icons used: ${Object.keys(stats.iconUsage).length}`);
  
  // Sort icons by usage
  const sortedIcons = Object.entries(stats.iconUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  
  console.log('\nTop 15 most used icons:');
  sortedIcons.forEach(([icon, count], index) => {
    console.log(`${index + 1}. ${icon}: ${count} uses`);
  });
  
  // Icons not in our map
  const unknownIcons = Object.keys(stats.iconUsage).filter(
    icon => !Object.keys(iconNameToPath).includes(icon)
  );
  
  if (unknownIcons.length > 0) {
    console.log('\n⚠️ Unknown icons (not in mapping):');
    unknownIcons.forEach(icon => {
      console.log(`- ${icon} (${stats.iconUsage[icon]} uses)`);
    });
  }
  
  if (stats.errors.length > 0) {
    console.log('\n❌ Errors:');
    stats.errors.forEach(({ file, error }) => {
      console.log(`- ${file}: ${error}`);
    });
  }
  
  // Savings estimate
  const totalIcons = Object.keys(iconNameToPath).length;
  const usedIcons = Object.keys(stats.iconUsage).length;
  const unusedIcons = totalIcons - usedIcons;
  const approxSavingsPercent = (unusedIcons / totalIcons * 100).toFixed(1);
  
  console.log('\n💾 Optimization potential:');
  console.log(`Using ${usedIcons} out of ${totalIcons} available icons (${approxSavingsPercent}% potential savings)`);
  
  if (!analyzeOnly && !applyChanges) {
    console.log('\n⚠️ This was a dry run. No files were modified.');
    console.log('To apply changes, run: node update-icon-imports.js --apply');
  } else if (analyzeOnly) {
    console.log('\n🔍 Analysis only mode. No files were modified.');
  }
}

// Run the script
main();