(function () {
    const extensionName = "auto-retry-on-error-corrected";
    const defaultSettings = {
        enabled: true,
        maxRetries: 3,
        retryDelay: 2000, // ms
        exponentialBackoff: true,
        backoffMultiplier: 2,
    };

    let settings = {};
    const originalFunctions = {};

    function getPluginSettings() {
        const context = SillyTavern.getContext();
        if (Object.keys(context.extensionSettings[extensionName] ?? {}).length === 0) {
            context.extensionSettings[extensionName] = { ...defaultSettings };
        }
        return context.extensionSettings[extensionName];
    }

    function saveSettings() {
        SillyTavern.getContext().saveSettingsDebounced();
    }

    function isRetryableError(error) {
        // Per user request, all errors are now considered retryable.
        if (!error) return false; // Don't retry on null/undefined errors
        return true;
    }

    function calculateRetryDelay(attempt) {
        if (settings.exponentialBackoff) {
            return settings.retryDelay * Math.pow(settings.backoffMultiplier, attempt);
        }
        return settings.retryDelay;
    }

    async function retryWrapper(originalFunction, args, functionName) {
        if (!settings.enabled) {
            return originalFunction.apply(this, args);
        }

        let lastError;
        for (let attempt = 0; attempt < settings.maxRetries; attempt++) {
            try {
                return await originalFunction.apply(this, args);
            } catch (error) {
                lastError = error;
                if (isRetryableError(error)) {
                    const delay = calculateRetryDelay(attempt);
                    toastr.info(`'${functionName}' failed. Retrying in ${delay / 1000}s... (Attempt ${attempt + 1}/${settings.maxRetries})`, "Auto Retry");
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                } else {
                    // Non-retryable error, break the loop and throw
                    break;
                }
            }
        }
        toastr.error(`'${functionName}' failed after ${settings.maxRetries} attempts.`, "Auto Retry Failed");
        throw lastError;
    }

    function patchFunction(owner, functionName) {
        if (typeof owner[functionName] === 'function') {
            const original = owner[functionName];
            // Avoid double-patching
            if (original.isPatchedByAutoRetry) return;

            originalFunctions[functionName] = original;
            owner[functionName] = function(...args) {
                return retryWrapper(original, args, functionName);
            };
            owner[functionName].isPatchedByAutoRetry = true;
            console.log(`[AutoRetry] Patched ${functionName}`);
        }
    }

    function addSettingsUI() {
        const html = `
            <div class="auto-retry-settings-block">
                <h4>Auto Retry on Error</h4>
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <span>Settings</span>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <label>
                            <input id="auto-retry-enabled" type="checkbox"> Enable
                        </label>
                        <label>
                            Max Retries: <input id="auto-retry-max-retries" type="number" min="0" max="10">
                        </label>
                        <label>
                            Initial Delay (ms): <input id="auto-retry-delay" type="number" min="500" max="10000" step="500">
                        </label>
                        <label>
                            <input id="auto-retry-exp-backoff" type="checkbox"> Exponential Backoff
                        </label>
                    </div>
                </div>
            </div>
        `;
        $('#extensions_settings').append(html);

        // Load settings into UI
        $('#auto-retry-enabled').prop('checked', settings.enabled);
        $('#auto-retry-max-retries').val(settings.maxRetries);
        $('#auto-retry-delay').val(settings.retryDelay);
        $('#auto-retry-exp-backoff').prop('checked', settings.exponentialBackoff);

        // Add event listeners
        $('#auto-retry-enabled').on('change', function() { settings.enabled = $(this).is(':checked'); saveSettings(); });
        $('#auto-retry-max-retries').on('input', function() { settings.maxRetries = parseInt($(this).val(), 10); saveSettings(); });
        $('#auto-retry-delay').on('input', function() { settings.retryDelay = parseInt($(this).val(), 10); saveSettings(); });
        $('#auto-retry-exp-backoff').on('change', function() { settings.exponentialBackoff = $(this).is(':checked'); saveSettings(); });
    }

    function onAppReady() {
        settings = getPluginSettings();
        addSettingsUI();

        // Patch the core functions that send requests
        patchFunction(window, 'sendGenerationRequest');
        patchFunction(window, 'sendStreamingRequest');

        // Some APIs have their own request functions, patch them too if they exist
        // This requires checking for the existence of these functions as they might not always be loaded
        if (window.openai) {
            patchFunction(window.openai, 'sendOpenAIRequest');
        }
    }

    SillyTavern.getContext().eventSource.on(SillyTavern.getContext().event_types.APP_READY, onAppReady);
})();
