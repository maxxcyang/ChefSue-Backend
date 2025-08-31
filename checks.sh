#!/bin/bash

# ChefSue Backend - Code Quality Checks
# This script runs various code quality checks and tests

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

print_header() {
    echo
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} $1${NC}"
    echo -e "${BLUE}============================================${NC}"
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Run this script from the project root."
    exit 1
fi

print_header "ChefSue Backend Code Quality Checks"

# 1. Check Node.js version
print_status "Checking Node.js version..."
NODE_VERSION=$(node --version)
print_success "Node.js version: $NODE_VERSION"

# 2. Check npm dependencies
print_status "Checking npm dependencies..."
if npm list --depth=0 > /dev/null 2>&1; then
    print_success "All npm dependencies are installed"
else
    print_warning "Some npm dependencies may be missing"
    npm list --depth=0 || true
fi

# 3. Check for security vulnerabilities
print_status "Checking for security vulnerabilities..."
if command -v npm &> /dev/null; then
    if npm audit --audit-level=moderate > /dev/null 2>&1; then
        print_success "No security vulnerabilities found"
    else
        print_warning "Security vulnerabilities detected:"
        npm audit --audit-level=moderate
    fi
fi

# 4. Check file structure
print_status "Checking project file structure..."
REQUIRED_FILES=(
    "server.js"
    "package.json"
    ".env"
    "services/aiService.js"
    "services/mealdbService.js"
    "services/ragPipeline.js"
    "utils/prompts.js"
    "utils/validators.js"
    "middleware/errorHandler.js"
)

MISSING_FILES=()
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        MISSING_FILES+=("$file")
    fi
done

if [ ${#MISSING_FILES[@]} -eq 0 ]; then
    print_success "All required files are present"
else
    print_error "Missing required files:"
    for file in "${MISSING_FILES[@]}"; do
        echo "  - $file"
    done
fi

# 5. Check environment configuration
print_status "Checking environment configuration..."
if [ -f ".env" ]; then
    REQUIRED_ENV_VARS=(
        "PORT"
        "AWS_ACCESS_KEY_ID"
        "AWS_SECRET_ACCESS_KEY"
        "AWS_REGION"
        "BEDROCK_MODEL_ID"
        "MEALDB_BASE_URL"
    )
    
    MISSING_ENV_VARS=()
    for var in "${REQUIRED_ENV_VARS[@]}"; do
        if ! grep -q "^${var}=" .env; then
            MISSING_ENV_VARS+=("$var")
        fi
    done
    
    if [ ${#MISSING_ENV_VARS[@]} -eq 0 ]; then
        print_success "All required environment variables are configured"
    else
        print_warning "Missing environment variables:"
        for var in "${MISSING_ENV_VARS[@]}"; do
            echo "  - $var"
        done
    fi
    
    # Check for placeholder values
    if grep -q "your_access_key_here\|your_secret_access_key_here" .env; then
        print_warning "Environment file contains placeholder values - update with real credentials"
    fi
else
    print_error ".env file not found"
fi

# 6. JavaScript syntax check
print_status "Checking JavaScript syntax..."
JS_FILES=$(find . -name "*.js" -not -path "./node_modules/*" -not -path "./.git/*")
SYNTAX_ERRORS=0

for file in $JS_FILES; do
    if ! node -c "$file" > /dev/null 2>&1; then
        print_error "Syntax error in: $file"
        node -c "$file"
        SYNTAX_ERRORS=$((SYNTAX_ERRORS + 1))
    fi
done

if [ $SYNTAX_ERRORS -eq 0 ]; then
    print_success "No JavaScript syntax errors found"
else
    print_error "Found $SYNTAX_ERRORS syntax errors"
fi

# 7. Check for common security issues
print_status "Checking for common security issues..."
SECURITY_ISSUES=0

# Check for hardcoded secrets
if grep -r "sk-\|AKIA\|password\|secret" --include="*.js" . --exclude-dir=node_modules 2>/dev/null | grep -v "process.env" | grep -v "// " | grep -v "\*" > /dev/null; then
    print_warning "Potential hardcoded secrets found:"
    grep -r "sk-\|AKIA\|password\|secret" --include="*.js" . --exclude-dir=node_modules 2>/dev/null | grep -v "process.env" | grep -v "// " | grep -v "\*" || true
    SECURITY_ISSUES=$((SECURITY_ISSUES + 1))
fi

# Check for console.log statements (should be replaced with proper logging)
# Exclude logger.js since it legitimately needs console statements
if grep -r "console.log\|console.error" --include="*.js" . --exclude-dir=node_modules 2>/dev/null | grep -v "utils/logger.js" > /dev/null; then
    print_warning "Console statements found (consider using proper logging):"
    grep -r "console.log\|console.error" --include="*.js" . --exclude-dir=node_modules 2>/dev/null | grep -v "utils/logger.js" | head -5
    echo "  ... and possibly more"
else
    print_success "All console statements properly replaced with logger"
fi

# Check for TODO/FIXME comments
if grep -r "TODO\|FIXME\|HACK" --include="*.js" . --exclude-dir=node_modules > /dev/null; then
    print_warning "TODO/FIXME comments found:"
    grep -r "TODO\|FIXME\|HACK" --include="*.js" . --exclude-dir=node_modules | head -5
    echo "  ... and possibly more"
fi

if [ $SECURITY_ISSUES -eq 0 ]; then
    print_success "No obvious security issues found"
fi

# 8. Check for unused dependencies
print_status "Checking for unused dependencies..."
if command -v npx &> /dev/null; then
    # This would require depcheck to be installed
    # For now, just check if all major dependencies are imported somewhere
    MAIN_DEPS=("express" "cors" "dotenv" "axios" "uuid")
    UNUSED_DEPS=()
    
    for dep in "${MAIN_DEPS[@]}"; do
        if ! grep -r "require.*$dep\|import.*$dep" --include="*.js" . --exclude-dir=node_modules > /dev/null; then
            UNUSED_DEPS+=("$dep")
        fi
    done
    
    if [ ${#UNUSED_DEPS[@]} -eq 0 ]; then
        print_success "All major dependencies appear to be used"
    else
        print_warning "Potentially unused dependencies:"
        for dep in "${UNUSED_DEPS[@]}"; do
            echo "  - $dep"
        done
    fi
fi

# 9. Check server startup (syntax and module loading only)
print_status "Testing server startup (syntax check)..."

# Use different timeout commands based on OS
TIMEOUT_CMD="timeout"
if command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT_CMD="gtimeout"
elif ! command -v timeout >/dev/null 2>&1; then
    # No timeout available, just run the test
    TIMEOUT_CMD=""
fi

if [ -n "$TIMEOUT_CMD" ]; then
    $TIMEOUT_CMD 10 node -e "
try {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  process.env.NODE_ENV = 'test';
  
  const originalListen = require('http').Server.prototype.listen;
  require('http').Server.prototype.listen = function() {
    console.log('Server syntax test passed');
    process.exit(0);
  };
  
  require('./server.js');
} catch (error) {
  console.error('Server startup test failed:', error.message);
  process.exit(1);
}
" >/dev/null 2>&1 && print_success "Server syntax and modules are valid" || print_error "Server startup test failed"
else
    # Fallback without timeout
    node -e "
try {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  process.env.NODE_ENV = 'test';
  
  const originalListen = require('http').Server.prototype.listen;
  require('http').Server.prototype.listen = function() {
    process.exit(0);
  };
  
  require('./server.js');
} catch (error) {
  process.exit(1);
}
" >/dev/null 2>&1 && print_success "Server syntax and modules are valid" || print_error "Server startup test failed"
fi

# 10. Check API endpoints (if server is not running)
print_status "Checking API endpoint definitions..."
if grep -q "app.post.*api/chat" server.js && grep -q "app.get.*health" server.js; then
    print_success "Main API endpoints are defined"
else
    print_error "Main API endpoints not found in server.js"
fi

# 11. Code complexity check (basic)
print_status "Checking code complexity..."
COMPLEX_FUNCTIONS=0
for file in $JS_FILES; do
    # Count functions with many nested levels (rough complexity check)
    NESTED_LEVELS=$(grep -o '{' "$file" | wc -l)
    LINES=$(wc -l < "$file")
    if [ "$LINES" -gt 0 ] && [ "$NESTED_LEVELS" -gt 0 ]; then
        COMPLEXITY_RATIO=$((NESTED_LEVELS * 100 / LINES))
        if [ $COMPLEXITY_RATIO -gt 50 ]; then
            print_warning "High complexity in: $file (ratio: $COMPLEXITY_RATIO%)"
            COMPLEX_FUNCTIONS=$((COMPLEX_FUNCTIONS + 1))
        fi
    fi
done

if [ $COMPLEX_FUNCTIONS -eq 0 ]; then
    print_success "No highly complex functions detected"
fi

# 12. Documentation check
print_status "Checking documentation..."
DOC_SCORE=0
[ -f "README.md" ] && DOC_SCORE=$((DOC_SCORE + 1))
[ -f "package.json" ] && grep -q "description" package.json && DOC_SCORE=$((DOC_SCORE + 1))

# Check for JSDoc comments
if grep -r "\/\*\*\|@param\|@returns" --include="*.js" . --exclude-dir=node_modules > /dev/null; then
    DOC_SCORE=$((DOC_SCORE + 1))
fi

if [ $DOC_SCORE -ge 2 ]; then
    print_success "Good documentation coverage"
else
    print_warning "Consider improving documentation"
fi

# Summary
print_header "Summary"

TOTAL_CHECKS=12
PASSED_CHECKS=0

# Count successful checks (this is a simplified count)
[ ${#MISSING_FILES[@]} -eq 0 ] && PASSED_CHECKS=$((PASSED_CHECKS + 1))
[ ${#MISSING_ENV_VARS[@]} -eq 0 ] && PASSED_CHECKS=$((PASSED_CHECKS + 1))
[ $SYNTAX_ERRORS -eq 0 ] && PASSED_CHECKS=$((PASSED_CHECKS + 1))
[ $SECURITY_ISSUES -eq 0 ] && PASSED_CHECKS=$((PASSED_CHECKS + 1))
[ $COMPLEX_FUNCTIONS -eq 0 ] && PASSED_CHECKS=$((PASSED_CHECKS + 1))
[ $DOC_SCORE -ge 2 ] && PASSED_CHECKS=$((PASSED_CHECKS + 1))

echo "Passed: $PASSED_CHECKS/$TOTAL_CHECKS checks"

if [ $PASSED_CHECKS -eq $TOTAL_CHECKS ]; then
    print_success "All checks passed! Code quality looks good."
    exit 0
elif [ $PASSED_CHECKS -ge $((TOTAL_CHECKS * 2 / 3)) ]; then
    print_warning "Most checks passed. Consider addressing the warnings above."
    exit 0
else
    print_error "Several checks failed. Please address the issues above."
    exit 1
fi