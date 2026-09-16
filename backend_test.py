#!/usr/bin/env python3
"""
Backend API tests for CreateOS
Tests the POST /api/ai/build-post endpoint to verify single image format fix
"""

import requests
import json
import os
import sys
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
load_dotenv(Path(__file__).parent / 'frontend' / '.env')

# Get backend URL from environment
BACKEND_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://single-to-carousel.preview.emergentagent.com')
API_BASE = f"{BACKEND_URL}/api"

# Colors for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def log_test(name):
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}TEST: {name}{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")

def log_success(msg):
    print(f"{GREEN}✓ {msg}{RESET}")

def log_error(msg):
    print(f"{RED}✗ {msg}{RESET}")

def log_info(msg):
    print(f"{YELLOW}ℹ {msg}{RESET}")

def test_build_post_single_instagram():
    """Test 1: POST /api/ai/build-post with format='single' on Instagram"""
    log_test("Single image post on Instagram - should return exactly 1 asset")
    
    payload = {
        "topic": "morning productivity habits",
        "platform": "instagram",
        "format": "single"
    }
    
    try:
        log_info(f"Calling POST {API_BASE}/ai/build-post")
        log_info(f"Payload: {json.dumps(payload, indent=2)}")
        
        response = requests.post(
            f"{API_BASE}/ai/build-post",
            json=payload,
            timeout=60
        )
        
        log_info(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_error(f"Expected status 200, got {response.status_code}")
            log_error(f"Response: {response.text[:500]}")
            return False
        
        data = response.json()
        
        # Check format
        returned_format = data.get("format")
        if returned_format != "single":
            log_error(f"Expected format='single', got format='{returned_format}'")
            return False
        log_success(f"Format is 'single' ✓")
        
        # Check assets array
        assets = data.get("assets", [])
        asset_count = len(assets)
        
        log_info(f"Number of assets returned: {asset_count}")
        
        if asset_count != 1:
            log_error(f"Expected exactly 1 asset, got {asset_count}")
            log_error(f"Assets: {json.dumps(assets, indent=2)}")
            return False
        log_success(f"Exactly 1 asset returned ✓")
        
        # Check that the single asset is NOT a "slide" template
        asset = assets[0]
        template = asset.get("spec", {}).get("template")
        log_info(f"Asset template: {template}")
        
        if template == "slide":
            log_error(f"Single format should NOT have template='slide', got '{template}'")
            return False
        
        if template not in ["cover", "quote", "infographic"]:
            log_error(f"Expected template to be one of [cover, quote, infographic], got '{template}'")
            return False
        
        log_success(f"Asset template is '{template}' (valid for single format) ✓")
        
        log_success("TEST PASSED: Single format returns exactly 1 asset with correct template")
        return True
        
    except requests.exceptions.Timeout:
        log_error("Request timed out after 60 seconds")
        return False
    except Exception as e:
        log_error(f"Exception occurred: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_build_post_story_instagram():
    """Test 2: POST /api/ai/build-post with format='story' on Instagram"""
    log_test("Story format on Instagram - should return exactly 1 asset")
    
    payload = {
        "topic": "why remote work wins",
        "platform": "instagram",
        "format": "story"
    }
    
    try:
        log_info(f"Calling POST {API_BASE}/ai/build-post")
        log_info(f"Payload: {json.dumps(payload, indent=2)}")
        
        response = requests.post(
            f"{API_BASE}/ai/build-post",
            json=payload,
            timeout=60
        )
        
        log_info(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_error(f"Expected status 200, got {response.status_code}")
            log_error(f"Response: {response.text[:500]}")
            return False
        
        data = response.json()
        
        # Check format
        returned_format = data.get("format")
        if returned_format != "story":
            log_error(f"Expected format='story', got format='{returned_format}'")
            return False
        log_success(f"Format is 'story' ✓")
        
        # Check assets array
        assets = data.get("assets", [])
        asset_count = len(assets)
        
        log_info(f"Number of assets returned: {asset_count}")
        
        if asset_count != 1:
            log_error(f"Expected exactly 1 asset, got {asset_count}")
            log_error(f"Assets: {json.dumps(assets, indent=2)}")
            return False
        log_success(f"Exactly 1 asset returned ✓")
        
        # Check that the single asset is NOT a "slide" template
        asset = assets[0]
        template = asset.get("spec", {}).get("template")
        log_info(f"Asset template: {template}")
        
        if template == "slide":
            log_error(f"Story format should NOT have template='slide', got '{template}'")
            return False
        
        log_success(f"Asset template is '{template}' (no 'slide' template) ✓")
        
        log_success("TEST PASSED: Story format returns exactly 1 asset without 'slide' template")
        return True
        
    except requests.exceptions.Timeout:
        log_error("Request timed out after 60 seconds")
        return False
    except Exception as e:
        log_error(f"Exception occurred: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_build_post_carousel_instagram():
    """Test 3: POST /api/ai/build-post with format='carousel' on Instagram"""
    log_test("Carousel format on Instagram - should return multiple assets (cover + slides)")
    
    payload = {
        "topic": "5 habits of great writers",
        "platform": "instagram",
        "format": "carousel"
    }
    
    try:
        log_info(f"Calling POST {API_BASE}/ai/build-post")
        log_info(f"Payload: {json.dumps(payload, indent=2)}")
        
        response = requests.post(
            f"{API_BASE}/ai/build-post",
            json=payload,
            timeout=60
        )
        
        log_info(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_error(f"Expected status 200, got {response.status_code}")
            log_error(f"Response: {response.text[:500]}")
            return False
        
        data = response.json()
        
        # Check format
        returned_format = data.get("format")
        if returned_format != "carousel":
            log_error(f"Expected format='carousel', got format='{returned_format}'")
            return False
        log_success(f"Format is 'carousel' ✓")
        
        # Check assets array
        assets = data.get("assets", [])
        asset_count = len(assets)
        
        log_info(f"Number of assets returned: {asset_count}")
        
        if asset_count <= 1:
            log_error(f"Expected more than 1 asset for carousel, got {asset_count}")
            log_error(f"Assets: {json.dumps(assets, indent=2)}")
            return False
        log_success(f"Multiple assets returned ({asset_count} assets) ✓")
        
        # Check first asset is a cover
        first_asset = assets[0]
        first_template = first_asset.get("spec", {}).get("template")
        log_info(f"First asset template: {first_template}")
        
        if first_template != "cover":
            log_error(f"First asset should be 'cover', got '{first_template}'")
            return False
        log_success(f"First asset is 'cover' ✓")
        
        # Check that subsequent assets are slides
        slide_count = 0
        for i, asset in enumerate(assets[1:], start=1):
            template = asset.get("spec", {}).get("template")
            if template == "slide":
                slide_count += 1
        
        log_info(f"Number of 'slide' template assets: {slide_count}")
        
        if slide_count == 0:
            log_error("Carousel should have at least one 'slide' template asset after the cover")
            return False
        log_success(f"Carousel has {slide_count} 'slide' template assets ✓")
        
        log_success("TEST PASSED: Carousel format returns cover + multiple slides")
        return True
        
    except requests.exceptions.Timeout:
        log_error("Request timed out after 60 seconds")
        return False
    except Exception as e:
        log_error(f"Exception occurred: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_build_post_single_linkedin():
    """Test 4: Regression test - POST /api/ai/build-post with format='single' on LinkedIn"""
    log_test("Single image post on LinkedIn - regression test")
    
    payload = {
        "topic": "quick coffee tip",
        "platform": "linkedin",
        "format": "single"
    }
    
    try:
        log_info(f"Calling POST {API_BASE}/ai/build-post")
        log_info(f"Payload: {json.dumps(payload, indent=2)}")
        
        response = requests.post(
            f"{API_BASE}/ai/build-post",
            json=payload,
            timeout=60
        )
        
        log_info(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_error(f"Expected status 200, got {response.status_code}")
            log_error(f"Response: {response.text[:500]}")
            return False
        
        data = response.json()
        
        # Check format
        returned_format = data.get("format")
        if returned_format != "single":
            log_error(f"Expected format='single', got format='{returned_format}'")
            return False
        log_success(f"Format is 'single' ✓")
        
        # Check assets array
        assets = data.get("assets", [])
        asset_count = len(assets)
        
        log_info(f"Number of assets returned: {asset_count}")
        
        if asset_count != 1:
            log_error(f"Expected exactly 1 asset, got {asset_count}")
            log_error(f"Assets: {json.dumps(assets, indent=2)}")
            return False
        log_success(f"Exactly 1 asset returned ✓")
        
        # Check that the single asset is NOT a "slide" template
        asset = assets[0]
        template = asset.get("spec", {}).get("template")
        log_info(f"Asset template: {template}")
        
        if template == "slide":
            log_error(f"Single format should NOT have template='slide', got '{template}'")
            return False
        
        log_success(f"Asset template is '{template}' (no 'slide' template) ✓")
        
        log_success("TEST PASSED: LinkedIn single format returns exactly 1 asset")
        return True
        
    except requests.exceptions.Timeout:
        log_error("Request timed out after 60 seconds")
        return False
    except Exception as e:
        log_error(f"Exception occurred: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def main():
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}CreateOS Backend API Tests - Build Post Endpoint{RESET}")
    print(f"{BLUE}Testing fix: Single image format should return 1 asset, not a carousel{RESET}")
    print(f"{BLUE}Backend URL: {BACKEND_URL}{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")
    
    results = []
    
    # Run all tests
    results.append(("Test 1: Single format (Instagram)", test_build_post_single_instagram()))
    results.append(("Test 2: Story format (Instagram)", test_build_post_story_instagram()))
    results.append(("Test 3: Carousel format (Instagram)", test_build_post_carousel_instagram()))
    results.append(("Test 4: Single format (LinkedIn) - Regression", test_build_post_single_linkedin()))
    
    # Summary
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}TEST SUMMARY{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = f"{GREEN}PASSED{RESET}" if result else f"{RED}FAILED{RESET}"
        print(f"{name}: {status}")
    
    print(f"\n{BLUE}Total: {passed}/{total} tests passed{RESET}")
    
    if passed == total:
        print(f"{GREEN}{'='*80}{RESET}")
        print(f"{GREEN}ALL TESTS PASSED ✓{RESET}")
        print(f"{GREEN}{'='*80}{RESET}")
        return 0
    else:
        print(f"{RED}{'='*80}{RESET}")
        print(f"{RED}SOME TESTS FAILED ✗{RESET}")
        print(f"{RED}{'='*80}{RESET}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
