#!/bin/bash
# On-demand database migration script
# This script installs drizzle-kit temporarily if not already installed,
# runs the migration, and then optionally uninstalls it to save space.

echo "Running database migration with on-demand drizzle-kit..."

# Check if drizzle-kit is installed in node_modules
if ! npm list drizzle-kit > /dev/null 2>&1; then
  echo "drizzle-kit not found, installing temporarily..."
  npm install --no-save drizzle-kit
  TEMP_INSTALLED=true
else
  echo "Using existing drizzle-kit installation..."
  TEMP_INSTALLED=false
fi

# Run the migration
echo "Running database migration..."
npx drizzle-kit push

# Report migration status
if [ $? -eq 0 ]; then
  echo "✅ Database migration completed successfully."
else
  echo "❌ Database migration failed."
  exit 1
fi

# Optionally uninstall drizzle-kit if it was temporarily installed
# Uncomment the lines below to enable automatic uninstallation
# if [ "$TEMP_INSTALLED" = true ]; then
#   echo "Removing temporary drizzle-kit installation..."
#   npm uninstall drizzle-kit
# fi

echo "Migration process complete."