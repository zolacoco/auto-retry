(function () {
    const extensionName = "auto-retry-on-error";
    const defaultSettings = {
        enabled: true,
        maxRetries: 3,
        retryDelay: 2000, // ms
        retryableStatusCodes: [500, 503],
    };

    let settings = {};

    function getPluginSettings() {
        const context = SillyTavern.getContext();
        if (Object.keys(context.extensionSettings[extensionName] ?? {}).length === 0) {
            context.extensionSettings[extensionName] = { ...defaultSettings };
        }
        return context.extensionSettings[extensionName];
    }

    function saveSettings() {
        const context = SillyTavern.getContext();
        context.saveSettingsDebounced();
    }

    function isRetryableError(error) {
        if (!error) return false;
        const status = error.status || error.response?.status;
        if (status && settings.retryableStatusCodes.includes(status)) {
            return true;
        }
        if (error.message) {
            const statusMatch = error.message.match(/status code (\d+)/i);
            if (statusMatch && settings.retryableStatusCodes.includes(parseInt(statusMatch[1], 10))) {
                return true;
            }
            if (settings.retryableStatusCodes.some(code => error.message.includes(String(code)))) {
                return true;
            }
        }
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            return true;
        }
        return false;
    }

    async function retryWrapper(originalFunction, args, functionName) {
        if (!settings.enabled) {
            return originalFunction.apply(this, args);
        }

        let lastError;
        for (let attempt = 0; attempt <= settings.maxRetries; attempt++) {
            try {
                const result = await originalFunction.apply(this, args);
                if (attempt > 0) {
                    toastr.success(`Request '${functionName}' succeeded after ${attempt} retries.`, "Auto Retry");
                }
                return result;
            } catch (error) {
                lastError = error;
                if (isRetryableError(error) && attempt < settings.maxRetries) {
                    const delay = settings.retryDelay;
                    toastr.info(`Request '${functionName}' failed. Retrying in ${delay / 1000}s... (Attempt ${attempt + 1}/${settings.maxRetries})`, "Auto Retry");
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                } else {
                    toastr.error(`Request '${functionName}' failed after ${attempt} retries.`, "Auto Retry");
                    throw lastError;
                }
            }
        }
        throw lastError;
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
                        <label for="auto-retry-enabled">
                            <input id="auto-retry-enabled" type="checkbox"> Enable
                        </label>
                        <label for="auto-retry-max-retries">
                            Max Retries: <input id="auto-retry-max-retries" type="number" min="0" max="10">
                        </label>
                        <label for="auto-retry-delay">
                            Retry Delay (ms): <input id="auto-retry-delay" type="number" min="500" max="10000" step="500">
                        </label>
                    </div>
                </div>
            </div>
        `;
        $('#api_settings_content').append(html);

        // Load settings into UI
        $('#auto-retry-enabled').prop('checked', settings.enabled);
        $('#auto-retry-max-retries').val(settings.maxRetries);
        $('#auto-retry-delay').val(settings.retryDelay);

        // Add event listeners
        $('#auto-retry-enabled').on('change', function() {
            settings.enabled = $(this).is(':checked');
            saveSettings();
        });
        $('#auto-retry-max-retries').on('input', function() {
            settings.maxRetries = parseInt($(this).val(), 10);
            saveSettings();
        });
        $('#auto-retry-delay').on('input', function() {
            settings.retryDelay = parseInt($(this).val(), 10);
            saveSettings();
        });
    }

    function patchFunctions() {
        const context = SillyTavern.getContext();

        // It's safer to patch functions on the window object if they exist there
        if (window.sendGenerationRequest) {
            const original = window.sendGenerationRequest;
            window.sendGenerationRequest = function(...args) {
                return retryWrapper(original, args, 'sendGenerationRequest');
            };
        }

        if (window.sendStreamingRequest) {
            const original = window.sendStreamingRequest;
            window.sendStreamingRequest = function(...args) {
                return retryWrapper(original, args, 'sendStreamingRequest');
            };
        }

        // Also patch the one in the context if it's different or for future-proofing
        if (context.sendGenerationRequest && context.sendGenerationRequest !== window.sendGenerationRequest) {
             const original = context.sendGenerationRequest;
             context.sendGenerationRequest = function(...args) {
                return retryWrapper(original, args, 'sendGenerationRequest');
            };
        }
    }


    function onAppReady() {
        settings = getPluginSettings();
        addSettingsUI();
        patchFunctions();
    }

    const context = SillyTavern.getContext();
    context.eventSource.on(context.event_types.APP_READY, onAppReady);
})();
