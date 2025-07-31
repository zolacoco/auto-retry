(function () {
    const extensionName = "auto-retry-on-error-final";
    const defaultSettings = {
        enabled: true,
        maxRetries: 3,
        retryDelay: 2000, // ms
        exponentialBackoff: true,
        backoffMultiplier: 2,
    };

    let settings = {};
    const originalFetch = window.fetch;

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

    async function fetchRetryWrapper(url, options) {
        let lastError;
        for (let attempt = 1; attempt <= settings.maxRetries + 1; attempt++) {
            try {
                const response = await originalFetch(url, options);

                if (!response.ok) {
                    const error = new Error(`Server responded with status ${response.status}`);
                    error.response = response;
                    error.status = response.status;
                    throw error;
                }

                if (attempt > 1) {
                    toastr.success(`Request succeeded on attempt ${attempt}.`, "Auto Retry");
                }
                return response; // Success

            } catch (error) {
                lastError = error;
                const path = new URL(url, window.location.origin).pathname;

                if (attempt > settings.maxRetries) {
                    break; // This was the last attempt, exit loop to throw error
                }

                if (isRetryableError(error)) {
                    const delay = calculateRetryDelay(attempt - 1);
                    toastr.info(`Request to ${path} failed. Retrying in ${delay / 1000}s... (Attempt ${attempt + 1}/${settings.maxRetries + 1})`, "Auto Retry");
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    break; // Non-retryable error, exit loop to throw error
                }
            }
        }

        toastr.error(`Request failed after ${settings.maxRetries + 1} attempts.`, "Auto Retry Failed");
        throw lastError;
    }

    const generationEndpoints = [
        '/api/backends/kobold/generate',
        '/api/backends/koboldhorde/generate',
        '/api/backends/text-completions/generate',
        '/api/novelai/generate',
        '/api/backends/chat-completions/generate'
    ];

    function patchGlobalFetch() {
        window.fetch = async function (url, options) {
            const path = new URL(url, window.location.origin).pathname;

            if (settings.enabled && generationEndpoints.includes(path) && options?.method === 'POST') {
                return fetchRetryWrapper(url, options);
            } else {
                return originalFetch(url, options);
            }
        };
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

        $('#auto-retry-enabled').prop('checked', settings.enabled);
        $('#auto-retry-max-retries').val(settings.maxRetries);
        $('#auto-retry-delay').val(settings.retryDelay);
        $('#auto-retry-exp-backoff').prop('checked', settings.exponentialBackoff);

        $('#auto-retry-enabled').on('change', function() { settings.enabled = $(this).is(':checked'); saveSettings(); });
        $('#auto-retry-max-retries').on('input', function() { settings.maxRetries = parseInt($(this).val(), 10); saveSettings(); });
        $('#auto-retry-delay').on('input', function() { settings.retryDelay = parseInt($(this).val(), 10); saveSettings(); });
        $('#auto-retry-exp-backoff').on('change', function() { settings.exponentialBackoff = $(this).is(':checked'); saveSettings(); });
    }

    function onAppReady() {
        settings = getPluginSettings();
        addSettingsUI();
        patchGlobalFetch();
    }

    SillyTavern.getContext().eventSource.on(SillyTavern.getContext().event_types.APP_READY, onAppReady);
})();
