#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## user_problem_statement: "Fix single image visual generating a carousel." When a user requests a single-image post via the Composer, the AI build-post flow sometimes returned a multi-slide carousel instead of one visual.

## backend:
##   - task: "ai/build-post single format returns one visual, not a carousel"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: false
##     status_history:
##         -working: "NA"
##         -agent: "main"
##         -comment: "_plan_to_assets now only builds a cover+slide deck when format is a DECK_FORMAT (carousel/thread). For single/story it emits exactly one visual asset (quote/infographic/photo/cover), with a cover fallback when the model returns only slides. Model previously returned a slides[] array even for single, which was honored and produced a carousel."
##         -working: false
##         -agent: "testing"
##         -comment: "Initial testing revealed the issue was NOT fully fixed. While _plan_to_assets correctly handles format logic, the problem was at line 4745-4746 where plan['format'] was only overridden if NOT in allowed list. When user requested format='single' but model returned format='carousel' (which IS allowed), it wasn't being overridden. Fixed by changing logic to: if fmt != 'auto', always use user's requested format; else if model's format not in allowed, use default."
##         -working: true
##         -agent: "testing"
##         -comment: "After fix at lines 4745-4750, all tests pass. Test 1: format='single' on Instagram returns exactly 1 asset with template='cover'. Test 2: format='story' on Instagram returns exactly 1 asset with template='cover'. Test 3: format='carousel' on Instagram returns 7 assets (1 cover + 6 slides). Test 4: format='single' on LinkedIn returns exactly 1 asset. No 'slide' template assets appear in single/story formats. Carousel functionality preserved."
##         -working: true
##         -agent: "testing"
##         -comment: "Regression test confirmed. POST /api/ai/build-post with {topic:'healthy breakfast ideas', platform:'instagram', format:'single'} returned 200 with format='single' and exactly 1 asset with template='cover'. No 'slide' template assets present. The fix continues to work correctly."

## metadata:
##   created_by: "main_agent"
##   version: "1.2"
##   test_sequence: 2
##   run_ui: false

## test_plan:
##   current_focus: []
##   stuck_tasks: []
##   test_all: false
##   test_priority: "high_first"

## agent_communication:
##     -agent: "main"
##     -message: "Please test POST /api/ai/build-post. Verify: (1) format='single' on instagram returns assets with exactly ONE item (not a cover+multiple slides). (2) format='story' returns one asset. (3) format='carousel' still returns a cover + multiple slide assets. (4) The single asset has a valid spec (template cover/quote/infographic). Uses PoYo/LLM key already in backend/.env."
##     -agent: "testing"
##     -message: "Bug found and fixed. The main agent's fix in _plan_to_assets was correct but incomplete. The root cause was that when user explicitly requested format='single', the model was returning format='carousel', and the code at line 4745 only overrode invalid formats, not valid-but-wrong ones. Fixed by always honoring user's explicit format choice when fmt != 'auto'. All 4 test cases now pass: single/story return 1 asset each, carousel returns multiple assets with correct structure."

## ---- 2026-09-16 session: download fix, delete media, save-as-project ----
## metadata:
##   created_by: "main_agent"
##   version: "1.3"
##   test_sequence: 3
##   run_ui: false

## test_plan:
##   current_focus: []
##   stuck_tasks: []
##   test_all: false
##   test_priority: "high_first"

## agent_communication:
##     -agent: "main"
##     -message: "DB restored (Cloudflare D1 creds added). Please verify backend: (1) POST /api/posts creates a post (returns id) and it appears in GET /api/posts; PUT /api/posts/{id} updates it. (2) Create a generation or use an existing one from GET /api/media, then DELETE /api/generations/{id} returns ok and the item disappears from GET /api/media. (3) Re-confirm POST /api/ai/build-post with format=single returns exactly one asset (regression)."
##     -agent: "testing"
##     -message: "All backend tests passed successfully. (1) Posts CRUD: POST creates post with id, GET lists it, PUT updates it (title changed from 'Test project' to 'Test project edited'), DELETE removes it. All operations return 200 and work correctly. (2) Generation delete: DELETE /api/generations/{id} returns 200 with {'ok': true} and the specific generation is removed from the database (verified by checking GET /api/media - the deleted ID is no longer present). (3) Regression test: POST /api/ai/build-post with format='single' returns exactly 1 asset with template='cover', no 'slide' templates. All three backend features are working correctly with Cloudflare D1."
