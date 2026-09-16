#!/usr/bin/env python3
"""
Backend API tests for CreateOS
Tests Posts CRUD, Generation delete, and AI build-post regression
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

def test_posts_crud():
    """Test Posts CRUD: POST, GET, PUT, DELETE /api/posts"""
    log_test("Posts CRUD - Create, Read, Update, Delete")
    
    created_post_id = None
    
    try:
        # 1. POST /api/posts - Create a post
        log_info("Step 1: Creating a new post with POST /api/posts")
        create_payload = {
            "title": "Test project",
            "content": "hello world",
            "platforms": ["instagram"],
            "status": "draft",
            "format": "single",
            "assets": []
        }
        
        log_info(f"Payload: {json.dumps(create_payload, indent=2)}")
        
        response = requests.post(
            f"{API_BASE}/posts",
            json=create_payload,
            timeout=30
        )
        
        log_info(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_error(f"Expected status 200, got {response.status_code}")
            log_error(f"Response: {response.text[:500]}")
            return False
        
        post_data = response.json()
        created_post_id = post_data.get("id")
        
        if not created_post_id:
            log_error("Response does not contain 'id' field")
            log_error(f"Response: {json.dumps(post_data, indent=2)}")
            return False
        
        log_success(f"Post created with id: {created_post_id}")
        log_info(f"Created post: {json.dumps(post_data, indent=2)[:200]}...")
        
        # 2. GET /api/posts - List posts and verify the created post is present
        log_info("Step 2: Listing all posts with GET /api/posts")
        
        response = requests.get(
            f"{API_BASE}/posts",
            timeout=30
        )
        
        log_info(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_error(f"Expected status 200, got {response.status_code}")
            log_error(f"Response: {response.text[:500]}")
            return False
        
        posts_list = response.json()
        
        if not isinstance(posts_list, list):
            log_error(f"Expected list response, got {type(posts_list)}")
            return False
        
        log_info(f"Total posts in list: {len(posts_list)}")
        
        # Find our created post
        found_post = None
        for post in posts_list:
            if post.get("id") == created_post_id:
                found_post = post
                break
        
        if not found_post:
            log_error(f"Created post with id {created_post_id} not found in list")
            return False
        
        log_success(f"Created post found in list")
        
        # Verify the post data matches what we created
        if found_post.get("title") != "Test project":
            log_error(f"Expected title 'Test project', got '{found_post.get('title')}'")
            return False
        
        log_success("Post title matches")
        
        # 3. PUT /api/posts/{id} - Update the post
        log_info(f"Step 3: Updating post with PUT /api/posts/{created_post_id}")
        
        update_payload = {
            "title": "Test project edited",
            "content": "hello world edited",
            "platforms": ["instagram"],
            "status": "draft",
            "format": "single",
            "assets": []
        }
        
        log_info(f"Update payload: {json.dumps(update_payload, indent=2)}")
        
        response = requests.put(
            f"{API_BASE}/posts/{created_post_id}",
            json=update_payload,
            timeout=30
        )
        
        log_info(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_error(f"Expected status 200, got {response.status_code}")
            log_error(f"Response: {response.text[:500]}")
            return False
        
        updated_post = response.json()
        
        if updated_post.get("title") != "Test project edited":
            log_error(f"Expected title 'Test project edited', got '{updated_post.get('title')}'")
            return False
        
        if updated_post.get("content") != "hello world edited":
            log_error(f"Expected content 'hello world edited', got '{updated_post.get('content')}'")
            return False
        
        log_success("Post updated successfully")
        log_info(f"Updated post: {json.dumps(updated_post, indent=2)[:200]}...")
        
        # 4. GET /api/posts again to verify the update persisted
        log_info("Step 4: Verifying update persisted with GET /api/posts")
        
        response = requests.get(
            f"{API_BASE}/posts",
            timeout=30
        )
        
        if response.status_code != 200:
            log_error(f"Expected status 200, got {response.status_code}")
            return False
        
        posts_list = response.json()
        found_post = None
        for post in posts_list:
            if post.get("id") == created_post_id:
                found_post = post
                break
        
        if not found_post:
            log_error(f"Updated post with id {created_post_id} not found in list")
            return False
        
        if found_post.get("title") != "Test project edited":
            log_error(f"Update did not persist. Expected title 'Test project edited', got '{found_post.get('title')}'")
            return False
        
        log_success("Update persisted correctly")
        
        # 5. DELETE /api/posts/{id} - Clean up
        log_info(f"Step 5: Deleting post with DELETE /api/posts/{created_post_id}")
        
        response = requests.delete(
            f"{API_BASE}/posts/{created_post_id}",
            timeout=30
        )
        
        log_info(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_error(f"Expected status 200, got {response.status_code}")
            log_error(f"Response: {response.text[:500]}")
            return False
        
        delete_response = response.json()
        
        if delete_response.get("ok") != True:
            log_error(f"Expected {{'ok': true}}, got {delete_response}")
            return False
        
        log_success("Post deleted successfully")
        
        # Verify the post is no longer in the list
        log_info("Step 6: Verifying post is deleted with GET /api/posts")
        
        response = requests.get(
            f"{API_BASE}/posts",
            timeout=30
        )
        
        if response.status_code != 200:
            log_error(f"Expected status 200, got {response.status_code}")
            return False
        
        posts_list = response.json()
        found_post = None
        for post in posts_list:
            if post.get("id") == created_post_id:
                found_post = post
                break
        
        if found_post:
            log_error(f"Post with id {created_post_id} still exists after deletion")
            return False
        
        log_success("Post successfully removed from list")
        
        log_success("TEST PASSED: Posts CRUD flow works correctly")
        return True
        
    except requests.exceptions.Timeout:
        log_error("Request timed out")
        return False
    except Exception as e:
        log_error(f"Exception occurred: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_generation_delete():
    """Test Generation delete: GET /api/media, DELETE /api/generations/{id}"""
    log_test("Generation Delete - Delete generated media")
    
    try:
        # 1. GET /api/media - List existing generations
        log_info("Step 1: Listing existing media with GET /api/media")
        
        response = requests.get(
            f"{API_BASE}/media",
            timeout=30
        )
        
        log_info(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_error(f"Expected status 200, got {response.status_code}")
            log_error(f"Response: {response.text[:500]}")
            return False
        
        media_list = response.json()
        
        if not isinstance(media_list, list):
            log_error(f"Expected list response, got {type(media_list)}")
            return False
        
        initial_count = len(media_list)
        log_info(f"Total media items: {initial_count}")
        
        # 2. Test DELETE endpoint
        if initial_count > 0:
            # We have at least one generation, delete it
            generation_to_delete = media_list[0]
            gen_id = generation_to_delete.get("id")
            
            if not gen_id:
                log_error("Media item does not have 'id' field")
                return False
            
            log_info(f"Step 2: Deleting generation with id {gen_id}")
            log_info(f"Generation to delete: {json.dumps(generation_to_delete, indent=2)[:200]}...")
            
            response = requests.delete(
                f"{API_BASE}/generations/{gen_id}",
                timeout=30
            )
            
            log_info(f"Response status: {response.status_code}")
            
            if response.status_code != 200:
                log_error(f"Expected status 200, got {response.status_code}")
                log_error(f"Response: {response.text[:500]}")
                return False
            
            delete_response = response.json()
            
            if delete_response.get("ok") != True:
                log_error(f"Expected {{'ok': true}}, got {delete_response}")
                return False
            
            log_success(f"Generation {gen_id} deleted successfully")
            
            # 3. GET /api/media again to verify the generation is gone
            log_info("Step 3: Verifying generation is deleted with GET /api/media")
            
            response = requests.get(
                f"{API_BASE}/media",
                timeout=30
            )
            
            if response.status_code != 200:
                log_error(f"Expected status 200, got {response.status_code}")
                return False
            
            media_list_after = response.json()
            final_count = len(media_list_after)
            
            log_info(f"Media count after delete: {final_count}")
            
            # Verify the specific generation is not in the list
            found = False
            for item in media_list_after:
                if item.get("id") == gen_id:
                    found = True
                    break
            
            if found:
                log_error(f"Generation {gen_id} still exists after deletion")
                return False
            
            log_success(f"Generation {gen_id} successfully removed from media list")
            
            # Note: Count may stay the same if there are more items than the limit (60)
            # The important check is that the specific ID is gone
            if final_count == initial_count:
                log_info(f"Count stayed at {final_count} (likely more than 60 total items, next item moved into view)")
            elif final_count == initial_count - 1:
                log_success(f"Count decreased from {initial_count} to {final_count}")
            else:
                log_error(f"Unexpected count change: from {initial_count} to {final_count}")
                return False
            log_success("TEST PASSED: Generation delete works correctly")
            return True
            
        else:
            # No generations exist, test with non-existent ID to verify 404
            log_info("No existing generations found")
            log_info("Step 2: Testing DELETE with non-existent ID (should return 404)")
            
            fake_id = "nonexistent-id-123"
            
            response = requests.delete(
                f"{API_BASE}/generations/{fake_id}",
                timeout=30
            )
            
            log_info(f"Response status: {response.status_code}")
            
            if response.status_code != 404:
                log_error(f"Expected status 404 for non-existent ID, got {response.status_code}")
                log_error(f"Response: {response.text[:500]}")
                return False
            
            log_success("DELETE endpoint correctly returns 404 for non-existent ID")
            log_success("TEST PASSED: Generation delete endpoint is wired correctly")
            return True
        
    except requests.exceptions.Timeout:
        log_error("Request timed out")
        return False
    except Exception as e:
        log_error(f"Exception occurred: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_build_post_regression():
    """Regression test: POST /api/ai/build-post with format='single' should return exactly 1 asset"""
    log_test("AI Build Post Regression - Single format should return 1 asset")
    
    payload = {
        "topic": "healthy breakfast ideas",
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
        
        # Check assets array length
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
        
        log_success("TEST PASSED: Single format regression test passed")
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
    print(f"{BLUE}CreateOS Backend API Tests{RESET}")
    print(f"{BLUE}Testing: Posts CRUD, Generation Delete, AI Build Post Regression{RESET}")
    print(f"{BLUE}Backend URL: {BACKEND_URL}{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")
    
    results = []
    
    # Run all tests
    results.append(("Test 1: Posts CRUD (POST, GET, PUT, DELETE)", test_posts_crud()))
    results.append(("Test 2: Generation Delete", test_generation_delete()))
    results.append(("Test 3: AI Build Post Regression (single format)", test_build_post_regression()))
    
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
