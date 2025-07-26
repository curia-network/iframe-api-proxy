/**
 * API Proxy Client - Customer page component
 * 
 * Runs in the customer page context and proxies API requests
 * through active iframes to bypass CSP restrictions.
 */

import { 
  ApiRequest, 
  ApiResponse, 
  getEndpointForMethod, 
  validateApiRequest,
  ProxyRequest,
  DirectApiRequest,
  PluginRequest,
  RequestOptions,
  validateProxyRequest
} from '../types/ApiTypes';
import { 
  ProxyApiResponseMessage,
  isProxyApiResponse,
  isProxyError,
  generateRequestId,
  createProxyRequest,
  createEnhancedProxyRequest
} from '../types/MessageTypes';
import { 
  ProxyClientConfig, 
  ProxyClientStatus, 
  ProxyError, 
  ProxyErrorType, 
  PendingRequest, 
  RequestTimeout,
  mergeClientConfig,
  createProxyError 
} from '../types/ProxyTypes';

/**
 * API Proxy Client
 * 
 * Handles API requests from forum iframes by proxying them through
 * the active iframe (auth or forum) to bypass CSP restrictions.
 * 
 * =============================================================================
 * 🚀 USAGE EXAMPLES
 * =============================================================================
 * 
 * // Legacy plugin-style requests (backward compatible)
 * const result = await apiProxy.makeApiRequest({
 *   method: 'getUserInfo',
 *   userId: 'user123',
 *   communityId: 'comm456'
 * });
 * 
 * // 🆕 Direct HTTP API calls
 * const sessions = await apiProxy.makeDirectRequest('/api/auth/sessions', {
 *   method: 'GET',
 *   headers: { 'Authorization': 'Bearer token123' }
 * });
 * 
 * // 🆕 Authenticated requests (convenience method)
 * const sessions = await apiProxy.makeAuthenticatedRequest('/api/auth/sessions', 'token123');
 * const profile = await apiProxy.makeAuthenticatedRequest('/api/user/profile', 'token123', {
 *   method: 'POST',
 *   body: { updateData: 'value' }
 * });
 * 
 * // 🆕 Enhanced plugin requests (explicit format)
 * const result = await apiProxy.makePluginRequest('getUserInfo', 'user123', 'comm456', {
 *   extraParam: 'value'
 * });
 * 
 * =============================================================================
 */
export class ApiProxyClient {
  private config: Required<ProxyClientConfig>;
  private isInitialized: boolean = false;
  private activeIframe: HTMLIFrameElement | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestTimeouts = new Map<string, RequestTimeout>();
  private messageListener: ((event: MessageEvent) => void) | null = null;
  
  // Statistics
  private totalRequests = 0;
  private totalErrors = 0;
  private responseTimes: number[] = [];
  private lastActivityTime = 0;

  constructor(config?: Partial<ProxyClientConfig>) {
    this.config = mergeClientConfig(config);
    this.initialize();
  }

  /**
   * Initialize the proxy client
   */
  private initialize(): void {
    this.setupMessageListener();
    this.isInitialized = true;
    
    if (this.config.debug) {
      console.log('[ApiProxyClient] Initialized with config:', this.config);
    }
  }

  /**
   * Set up the message listener for iframe communication
   */
  private setupMessageListener(): void {
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
    }

    this.messageListener = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') {
        return;
      }

      // Handle proxy API responses
      if (isProxyApiResponse(event.data)) {
        this.handleProxyResponse(event.data);
      }
      
      // Handle proxy errors
      if (isProxyError(event.data)) {
        this.handleProxyError(event.data);
      }
    };

    window.addEventListener('message', this.messageListener);
  }

  /**
   * Set the active iframe for API requests
   */
  public setActiveIframe(iframe: HTMLIFrameElement): void {
    this.activeIframe = iframe;
    
    if (this.config.debug) {
      console.log('[ApiProxyClient] Active iframe set:', iframe.src);
    }
  }

  /**
   * Clear the active iframe
   */
  public clearActiveIframe(): void {
    this.activeIframe = null;
    
    if (this.config.debug) {
      console.log('[ApiProxyClient] Active iframe cleared');
    }
  }

  /**
   * Make an API request through the active iframe
   */
  public async makeApiRequest(request: ApiRequest): Promise<ApiResponse> {
    if (!this.isInitialized) {
      throw createProxyError(
        ProxyErrorType.INITIALIZATION_ERROR,
        'Proxy client not initialized'
      );
    }

    if (!this.activeIframe) {
      throw createProxyError(
        ProxyErrorType.NO_ACTIVE_IFRAME,
        'No active iframe available for API requests'
      );
    }

    if (!validateApiRequest(request)) {
      throw createProxyError(
        ProxyErrorType.INVALID_REQUEST,
        'Invalid API request format'
      );
    }

    const requestId = generateRequestId();
    const startTime = Date.now();
    this.totalRequests++;
    this.lastActivityTime = startTime;

    return new Promise((resolve, reject) => {
      try {
        // Store pending request
        const pendingRequest: PendingRequest = {
          requestId,
          resolve,
          reject,
          startTime,
          retryCount: 0,
          originalRequest: request
        };
        
        this.pendingRequests.set(requestId, pendingRequest);
        
        // Set up timeout
        this.setupRequestTimeout(requestId);
        
        // Send request to active iframe
        this.sendRequestToIframe(requestId, request);
        
        if (this.config.debug) {
          console.log('[ApiProxyClient] API request sent:', {
            requestId,
            method: request.method,
            userId: request.userId,
            communityId: request.communityId
          });
        }
        
      } catch (error) {
        this.cleanupRequest(requestId);
        reject(error);
      }
    });
  }

  // =============================================================================
  // 🚀 NEW: Enhanced API Request Methods
  // =============================================================================

  /**
   * Make a direct HTTP API request through the active iframe
   */
  public async makeDirectRequest(url: string, options?: RequestOptions): Promise<any> {
    if (!this.isInitialized) {
      throw createProxyError(
        ProxyErrorType.INITIALIZATION_ERROR,
        'Proxy client not initialized'
      );
    }

    if (!this.activeIframe) {
      throw createProxyError(
        ProxyErrorType.NO_ACTIVE_IFRAME,
        'No active iframe available for API requests'
      );
    }

    const directRequest: DirectApiRequest = {
      type: 'direct',
      url,
      method: options?.method || 'GET',
      ...options
    };

    if (!validateProxyRequest(directRequest)) {
      throw createProxyError(
        ProxyErrorType.INVALID_REQUEST,
        'Invalid direct API request format'
      );
    }

    return this.makeEnhancedProxyRequest(directRequest);
  }

  /**
   * Make an authenticated API request (convenience method for requests with auth headers)
   */
  public async makeAuthenticatedRequest(url: string, token: string, options?: RequestOptions): Promise<any> {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers
    };

    return this.makeDirectRequest(url, {
      ...options,
      headers
    });
  }

  /**
   * Make a plugin-style request using the enhanced format
   */
  public async makePluginRequest(
    method: string,
    userId: string,
    communityId: string,
    params?: Record<string, any>,
    signature?: string
  ): Promise<ApiResponse> {
    if (!this.isInitialized) {
      throw createProxyError(
        ProxyErrorType.INITIALIZATION_ERROR,
        'Proxy client not initialized'
      );
    }

    if (!this.activeIframe) {
      throw createProxyError(
        ProxyErrorType.NO_ACTIVE_IFRAME,
        'No active iframe available for API requests'
      );
    }

    const pluginRequest: PluginRequest = {
      type: 'plugin',
      method,
      userId,
      communityId
    };

    // Only include optional properties if they're defined
    if (params !== undefined) {
      pluginRequest.params = params;
    }
    if (signature !== undefined) {
      pluginRequest.signature = signature;
    }

    if (!validateProxyRequest(pluginRequest)) {
      throw createProxyError(
        ProxyErrorType.INVALID_REQUEST,
        'Invalid plugin request format'
      );
    }

    return this.makeEnhancedProxyRequest(pluginRequest);
  }

  /**
   * Internal method to handle enhanced proxy requests
   */
  private async makeEnhancedProxyRequest(request: ProxyRequest): Promise<any> {
    const requestId = generateRequestId();
    const startTime = Date.now();
    this.totalRequests++;
    this.lastActivityTime = startTime;

    return new Promise((resolve, reject) => {
      try {
        // Store pending request
        const pendingRequest: PendingRequest = {
          requestId,
          resolve,
          reject,
          startTime,
          retryCount: 0,
          originalRequest: request  // Store the enhanced request
        };
        
        this.pendingRequests.set(requestId, pendingRequest);
        
        // Set up timeout
        this.setupRequestTimeout(requestId);
        
        // Send enhanced request to active iframe
        this.sendEnhancedRequestToIframe(requestId, request);
        
        if (this.config.debug) {
          console.log('[ApiProxyClient] Enhanced API request sent:', {
            requestId,
            type: request.type,
            ...(request.type === 'plugin' ? { method: request.method } : { url: request.url })
          });
        }
        
      } catch (error) {
        this.cleanupRequest(requestId);
        reject(error);
      }
    });
  }

  // =============================================================================
  // 🔄 EXISTING: Legacy API Request Method (maintained for backward compatibility)
  // =============================================================================

  /**
   * Send request to the active iframe
   */
  private sendRequestToIframe(requestId: string, request: ApiRequest): void {
    if (!this.activeIframe?.contentWindow) {
      throw createProxyError(
        ProxyErrorType.NO_ACTIVE_IFRAME,
        'Active iframe content window not available'
      );
    }

    const endpoint = getEndpointForMethod(request.method as any);
    const message = createProxyRequest(requestId, endpoint, request);
    
    this.activeIframe.contentWindow.postMessage(message, '*');
  }

  /**
   * Send enhanced request to the active iframe
   */
  private sendEnhancedRequestToIframe(requestId: string, request: ProxyRequest): void {
    if (!this.activeIframe?.contentWindow) {
      throw createProxyError(
        ProxyErrorType.NO_ACTIVE_IFRAME,
        'Active iframe content window not available'
      );
    }

    const message = createEnhancedProxyRequest(requestId, request);
    
    this.activeIframe.contentWindow.postMessage(message, '*');
  }

  /**
   * Set up request timeout
   */
  private setupRequestTimeout(requestId: string): void {
    const timeoutId = setTimeout(() => {
      this.handleRequestTimeout(requestId);
    }, this.config.defaultTimeout);

    this.requestTimeouts.set(requestId, {
      requestId,
      timeoutId,
      startTime: Date.now(),
      timeoutMs: this.config.defaultTimeout
    });
  }

  /**
   * Handle request timeout
   */
  private handleRequestTimeout(requestId: string): void {
    const pendingRequest = this.pendingRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

    const error = createProxyError(
      ProxyErrorType.TIMEOUT,
      `Request timeout after ${this.config.defaultTimeout}ms`,
      requestId
    );

    this.handleRequestError(requestId, error);
  }

  /**
   * Handle proxy response from iframe
   */
  private handleProxyResponse(message: ProxyApiResponseMessage): void {
    const pendingRequest = this.pendingRequests.get(message.requestId);
    if (!pendingRequest) {
      if (this.config.debug) {
        console.warn('[ApiProxyClient] Received response for unknown request:', message.requestId);
      }
      return;
    }

    const responseTime = Date.now() - pendingRequest.startTime;
    this.responseTimes.push(responseTime);
    
    // Keep only last 100 response times for average calculation
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }

    this.cleanupRequest(message.requestId);
    pendingRequest.resolve(message.response);

    if (this.config.debug) {
      console.log('[ApiProxyClient] API response received:', {
        requestId: message.requestId,
        responseTime: `${responseTime}ms`,
        success: message.response.success
      });
    }
  }

  /**
   * Handle proxy error from iframe
   */
  private handleProxyError(message: any): void {
    const error = createProxyError(
      ProxyErrorType.NETWORK_ERROR,
      message.error,
      message.requestId
    );

    this.handleRequestError(message.requestId, error);
  }

  /**
   * Handle request error
   */
  private handleRequestError(requestId: string, error: ProxyError): void {
    const pendingRequest = this.pendingRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

    this.totalErrors++;
    this.cleanupRequest(requestId);
    
    // Check if we should retry
    if (pendingRequest.retryCount < this.config.maxRetries) {
      this.retryRequest(pendingRequest, error);
    } else {
      pendingRequest.reject(error);
    }
  }

  /**
   * Retry a failed request
   */
  private retryRequest(pendingRequest: PendingRequest, lastError: ProxyError): void {
    pendingRequest.retryCount++;
    
    if (this.config.debug) {
      console.log('[ApiProxyClient] Retrying request:', {
        requestId: pendingRequest.requestId,
        retryCount: pendingRequest.retryCount,
        lastError: lastError.message
      });
    }

    setTimeout(() => {
      if (this.activeIframe) {
        // ✅ CORRECT: Keep same requestId - it's the same logical request
        this.pendingRequests.set(pendingRequest.requestId, pendingRequest);
        this.setupRequestTimeout(pendingRequest.requestId);
        
        // Send request with same ID (either legacy or enhanced format)
        if (pendingRequest.originalRequest && 'type' in pendingRequest.originalRequest) {
          // Enhanced request format
          this.sendEnhancedRequestToIframe(pendingRequest.requestId, pendingRequest.originalRequest as ProxyRequest);
        } else {
          // Legacy request format  
          this.sendRequestToIframe(pendingRequest.requestId, pendingRequest.originalRequest as ApiRequest);
        }
      } else {
        pendingRequest.reject(lastError);
      }
    }, this.config.retryDelay);
  }

  /**
   * Clean up request resources
   */
  private cleanupRequest(requestId: string): void {
    this.pendingRequests.delete(requestId);
    
    const timeout = this.requestTimeouts.get(requestId);
    if (timeout) {
      clearTimeout(timeout.timeoutId);
      this.requestTimeouts.delete(requestId);
    }
  }

  /**
   * Get proxy client status
   */
  public getStatus(): ProxyClientStatus {
    const averageResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length
      : 0;

    return {
      isInitialized: this.isInitialized,
      activeIframeCount: this.activeIframe ? 1 : 0,
      pendingRequestCount: this.pendingRequests.size,
      totalRequestCount: this.totalRequests,
      errorCount: this.totalErrors,
      averageResponseTime: Math.round(averageResponseTime),
      lastActivityTime: this.lastActivityTime
    };
  }

  /**
   * Destroy the proxy client
   */
  public destroy(): void {
    // Clear all pending requests
    this.pendingRequests.forEach(request => {
      request.reject(createProxyError(
        ProxyErrorType.INITIALIZATION_ERROR,
        'Proxy client destroyed'
      ));
    });
    this.pendingRequests.clear();

    // Clear all timeouts
    this.requestTimeouts.forEach(timeout => {
      clearTimeout(timeout.timeoutId);
    });
    this.requestTimeouts.clear();

    // Remove message listener
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }

    // Clear active iframe
    this.activeIframe = null;
    this.isInitialized = false;

    if (this.config.debug) {
      console.log('[ApiProxyClient] Destroyed');
    }
  }
} 