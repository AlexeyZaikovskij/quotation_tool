@echo off
cd /d D:\TCG\card-game-react-full
echo Merging dev into main...
git checkout main
git pull origin main
git merge dev
git push origin main
git checkout dev
echo.
echo Done! Production will update in 2-3 minutes.
echo Switched back to dev branch.
pause
