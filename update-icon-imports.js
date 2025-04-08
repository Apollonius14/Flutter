/**
 * Icon Import Update Script
 * 
 * This is a Node.js script that would search through your codebase,
 * find imports from lucide-react, and convert them to individual imports.
 * 
 * To use this script:
 * 1. Install required dependencies: npm install glob fs-extra
 * 2. Run it with: node update-icon-imports.js
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

// Map of lucide icon names to their file paths
const iconNameToPath = {
  'AlertCircle': 'alert-circle',
  'ArrowLeft': 'arrow-left',
  'ArrowRight': 'arrow-right',
  'Check': 'check',
  'ChevronDown': 'chevron-down',
  'ChevronLeft': 'chevron-left',
  'ChevronRight': 'chevron-right',
  'ChevronUp': 'chevron-up',
  'Circle': 'circle',
  'Dot': 'dot',
  'GitBranchPlus': 'git-branch-plus',
  'GripVertical': 'grip-vertical',
  'Languages': 'languages',
  'Loader': 'loader',
  'MoreHorizontal': 'more-horizontal',
  'PanelLeft': 'panel-left',
  'Search': 'search',
  'Waves': 'waves',
  'X': 'x'
};

// Find all TypeScript and TSX files
const files = await glob('client/src/**/*.{ts,tsx}');

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  
  // Find imports from lucide-react
  const importRegex = /import\s+{([^}]+)}\s+from\s+["']lucide-react["']/g;
  let match;
  let newContent = content;
  
  while ((match = importRegex.exec(content)) !== null) {
    const iconsList = match[1];
    // Get individual icon names
    const icons = iconsList.split(',').map(icon => icon.trim());
    
    // Create individual imports
    const newImports = icons
      .filter(icon => Object.keys(iconNameToPath).includes(icon))
      .map(icon => `import ${icon} from "lucide-react/dist/esm/icons/${iconNameToPath[icon]}";`)
      .join('\n');
    
    // Replace the old import with the new imports
    newContent = newContent.replace(match[0], newImports);
  }
  
  // Write the modified content back to the file
  if (newContent !== content) {
    fs.writeFileSync(file, newContent, 'utf8');
    console.log(`Updated imports in ${file}`);
  }
}

// Note: This is a proof of concept. In a production environment, 
// you'd want to add error handling, backup files before modifying them,
// and potentially make this script more robust.