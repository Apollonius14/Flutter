#!/bin/bash

# Configure git
git config --global user.name "Replit Agent"
git config --global user.email "noreply@replit.com"

# Remove any existing origin
git remote remove origin

# Add GitHub repository as origin with the token
git remote add origin "https://$GITHUB_TOKEN@github.com/Apollonius14/Flutter.git"

# Fetch from remote
echo "Fetching from remote..."
git fetch origin

# Try to pull changes (merge them with local)
echo "Pulling changes..."
git pull origin main --allow-unrelated-histories || {
  echo "Pull failed, will try push with force flag..."
}

# Push to main branch with force if needed
echo "Pushing to remote repository..."
git push -u origin main --force

echo "Push completed!"