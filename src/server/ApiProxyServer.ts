/**
 * API Proxy Server - Iframe component
 * 
 * Runs inside iframes (auth or forum) and handles API requests
 * from the customer page by making actual API calls to the host service.
 */

import { 
  ApiRequest, 
  ApiResponse,
  ProxyRequest,
  PluginRequest,
  DirectApiRequest,
  validateProxyRequest,
  convertLegacyRequest
} from '../types/ApiTypes';
import { 
  createProxyResponse,
  EnhancedProxyRequestMessage,
  LegacyProxyRequestMessage,
  AnyProxyRequestMessage,
  isAnyProxyRequest,
  isUsingEnhancedFormat
} from '../types/MessageTypes';
import { 
  ProxyServerConfig, 
  ProxyServerStatus, 
  ProxyErrorType, 
  mergeServerConfig,
  validateServerConfig,
  createProxyError,
  isOriginAllowed
} from '../types/ProxyTypes';

/**
 * API Proxy Server
 * 
 * Handles API proxy requests from the customer page by making
 * actual API calls to the host service and returning responses.
 * 
 * =============================================================================
 * 🚀 ENHANCED ARCHITECTURE
 * =============================================================================
 * 
 * The server now supports both legacy and new flexible request formats:
 * 
 * 📨 MESSAGE FORMATS:
 * - Legacy: { type: 'proxy-api-request', endpoint: '/api/user', payload: ApiRequest }
 * - Enhanced: { type: 'proxy-api-request', request: ProxyRequest }
 * 
 * 🔀 REQUEST TYPES:
 * - Plugin Requests: Traditional method-based calls with endpoint mapping
 * - Direct Requests: Full HTTP control (method, headers, body, URL)
 * 
 * 🛠️ PROCESSING FLOW:
 * 1. handleAnyProxyRequest() - Detects message format (legacy vs enhanced)
 * 2. processProxyRequest() - Routes to plugin or direct processing
 * 3. processPluginRequest() - Uses endpoint mapping + legacy makeApiRequest()
 * 4. processDirectRequest() - Full HTTP control via makeDirectHttpRequest()
 * 
 * 🔄 BACKWARD COMPATIBILITY:
 * - All existing legacy requests continue to work unchanged
 * - Legacy format automatically converted to enhanced format internally
 * - No breaking changes to current plugin usage
 * 
 * =============================================================================
 */
export class ApiProxyServer {
  private config: Required<ProxyServerConfig>;
  private isInitialized: boolean = false;
  private messageListener: ((event: MessageEvent) => void) | null = null;
  
  // Statistics
  private requestCount = 0;
  private errorCount = 0;
  private startTime = Date.now();
  private lastRequestTime = 0;

  constructor(config: ProxyServerConfig) {
    validateServerConfig(config);
    this.config = mergeServerConfig(config);
    this.initialize();
  }

  /**
   * Initialize the proxy server
   */
  private initialize(): void {
    this.setupMessageListener();
    this.isInitialized = true;
    
    // 🆕 Notify parent that API proxy is ready for requests
    this.notifyParentReady();
    
    if (this.config.debug) {
      console.log('[ApiProxyServer] Initialized with config:', {
        baseUrl: this.config.baseUrl,
        serverId: this.config.serverId,
        timeout: this.config.timeout,
        allowedOrigins: this.config.allowedOrigins
      });
    }
  }

  /**
   * Send ready notification to parent window
   * This enables event-driven API proxy usage instead of polling/retries
   */
  private notifyParentReady(): void {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'curia-api-proxy-ready',
        serverId: this.config.serverId,
        timestamp: new Date().toISOString()
      }, '*');
      
      if (this.config.debug) {
        console.log(`[ApiProxyServer] Ready notification sent to parent (serverId: ${this.config.serverId})`);
      }
    }
  }

  /**
   * Set up message listener for proxy requests
   */
  private setupMessageListener(): void {
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
    }

    this.messageListener = (event: MessageEvent) => {
      // Security check: validate origin if configured
      if (this.config.allowedOrigins.length > 0) {
        if (!isOriginAllowed(event.origin, this.config.allowedOrigins)) {
          if (this.config.debug) {
            console.warn('[ApiProxyServer] Request from unauthorized origin:', event.origin);
          }
          return;
        }
      }

      if (!event.data || typeof event.data !== 'object') {
        return;
      }

      // Handle proxy API requests (both legacy and enhanced formats)
      if (isAnyProxyRequest(event.data)) {
        this.handleAnyProxyRequest(event.data, event.source as Window);
      }
    };

    window.addEventListener('message', this.messageListener);
  }



  // =============================================================================
  // 🚀 NEW: Enhanced Request Handler for Flexible Request System
  // =============================================================================

  /**
   * Handle incoming proxy API request (both legacy and enhanced formats)
   */
  private async handleAnyProxyRequest(message: AnyProxyRequestMessage, source: Window): Promise<void> {
    this.requestCount++;
    this.lastRequestTime = Date.now();

    try {
      let response: any;

      if (isUsingEnhancedFormat(message)) {
        // Enhanced format: process ProxyRequest directly
        const enhancedMessage = message as EnhancedProxyRequestMessage;
        
        if (this.config.debug) {
          console.log('[ApiProxyServer] Received enhanced proxy request:', {
            requestId: enhancedMessage.requestId,
            type: enhancedMessage.request.type,
            ...(enhancedMessage.request.type === 'plugin' 
              ? { method: enhancedMessage.request.method } 
              : { url: enhancedMessage.request.url, method: enhancedMessage.request.method })
          });
        }

        response = await this.processProxyRequest(enhancedMessage.request);
      } else {
        // Legacy format: convert and process
        const legacyMessage = message as LegacyProxyRequestMessage;
        
        if (this.config.debug) {
          console.log('[ApiProxyServer] Received legacy proxy request:', {
            requestId: legacyMessage.requestId,
            endpoint: legacyMessage.endpoint,
            method: legacyMessage.payload.method,
            userId: legacyMessage.payload.userId,
            communityId: legacyMessage.payload.communityId
          });
        }

        // Convert legacy format to enhanced format
        const pluginRequest = convertLegacyRequest(legacyMessage.payload);
        response = await this.processProxyRequest(pluginRequest);
      }
      
      // Send successful response back to client
      this.sendSuccessResponse(source, message.requestId, response);
      
    } catch (error) {
      this.errorCount++;
      
      if (this.config.debug) {
        console.error('[ApiProxyServer] API request failed:', {
          requestId: message.requestId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      
      // Send error response back to client
      this.sendErrorResponse(source, message.requestId, error);
    }
  }

  /**
   * Process a proxy request (either plugin or direct API request)
   */
  private async processProxyRequest(request: ProxyRequest): Promise<any> {
    if (!validateProxyRequest(request)) {
      throw createProxyError(
        ProxyErrorType.INVALID_REQUEST,
        'Invalid proxy request format'
      );
    }

    if (request.type === 'plugin') {
      return this.processPluginRequest(request);
    } else if (request.type === 'direct') {
      return this.processDirectRequest(request);
    } else {
      throw createProxyError(
        ProxyErrorType.INVALID_REQUEST,
        `Unknown request type: ${(request as any).type}`
      );
    }
  }

  /**
   * Process a plugin-style request using the endpoint mapping
   */
  private async processPluginRequest(request: PluginRequest): Promise<ApiResponse> {
    // Use existing endpoint mapping logic for plugin requests
    const endpoint = this.getEndpointForPluginMethod(request.method);
    
    // Convert back to legacy format for compatibility with existing makeApiRequest
    const legacyRequest: ApiRequest = {
      method: request.method,
      userId: request.userId,
      communityId: request.communityId
    };
    
    // Only include optional properties if they're defined
    if (request.params !== undefined) {
      legacyRequest.params = request.params;
    }
    if (request.signature !== undefined) {
      legacyRequest.signature = request.signature;
    }
    
    return this.makeApiRequest(endpoint, legacyRequest);
  }

  /**
   * Process a direct HTTP API request
   */
  private async processDirectRequest(request: DirectApiRequest): Promise<ApiResponse> {
    const rawData = await this.makeDirectHttpRequest(request);
    
    // 🚀 FIX: Wrap direct HTTP response in ApiResponse format for client compatibility
    return {
      success: true,
      data: rawData
    };
  }

  /**
   * Get endpoint for plugin method (extracted from existing logic)
   */
  private getEndpointForPluginMethod(method: string): string {
    const methodToEndpoint: Record<string, string> = {
      'getUserInfo': '/api/user',
      'getUserFriends': '/api/user',
      'getContextData': '/api/user',
      'getCommunityInfo': '/api/community',
      'giveRole': '/api/community',
      'getUserCommunities': '/api/communities',
      'getUserProfile': '/api/auth/validate-session'
    };
    
    const endpoint = methodToEndpoint[method];
    if (!endpoint) {
      throw createProxyError(
        ProxyErrorType.INVALID_REQUEST,
        `Unknown plugin method: ${method}`
      );
    }
    
    return endpoint;
  }

  /**
   * Make a direct HTTP request with full control over method, headers, and body
   */
  private async makeDirectHttpRequest(request: DirectApiRequest): Promise<any> {
    const url = request.url.startsWith('http') 
      ? request.url 
      : `${this.config.baseUrl}${request.url}`;
    
    const requestOptions: RequestInit = {
      method: request.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
        ...request.headers
      }
    };
    
    // Add body for non-GET requests
    if (request.body && requestOptions.method !== 'GET') {
      requestOptions.body = typeof request.body === 'string' 
        ? request.body 
        : JSON.stringify(request.body);
    }
    
    // Handle timeout if specified
    const timeout = request.timeout || this.config.timeout;
    if (timeout > 0) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      requestOptions.signal = controller.signal;
      
      try {
        const response = await fetch(url, requestOptions);
        clearTimeout(timeoutId);
        return await this.processDirectHttpResponse(response);
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } else {
      const response = await fetch(url, requestOptions);
      return await this.processDirectHttpResponse(response);
    }
  }

  /**
   * Process response from direct HTTP request
   */
  private async processDirectHttpResponse(response: Response): Promise<any> {
    if (!response.ok) {
      throw createProxyError(
        ProxyErrorType.NETWORK_ERROR,
        `HTTP ${response.status}: ${response.statusText}`
      );
    }

    // Try to parse as JSON, fall back to text
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    } else {
      return await response.text();
    }
  }

  /**
   * Make API request to host service
   */
  private async makeApiRequest(endpoint: string, payload: ApiRequest): Promise<ApiResponse> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    // 🆕 NEW: Determine HTTP method and request format based on endpoint
    let requestOptions: RequestInit;
    
    if (endpoint === '/api/communities') {
      // GET request with Authorization header for communities
      requestOptions = {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${payload.params?.sessionToken}`,
          'Content-Type': 'application/json',
          ...this.config.headers
        }
      };
    } else if (endpoint === '/api/auth/validate-session') {
      // POST request with sessionToken in body for profile
      requestOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers
        },
        body: JSON.stringify({
          sessionToken: payload.params?.sessionToken
        })
      };
    } else {
      // 🔄 EXISTING: Standard POST format for plugin methods
      requestOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers
        },
        body: JSON.stringify(payload)
      };
    }

    // 🔄 EXISTING: Timeout handling logic (unchanged)
    if (this.config.timeout > 0) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
      requestOptions.signal = controller.signal;
      
      try {
        const response = await fetch(url, requestOptions);
        clearTimeout(timeoutId);
        
        // 🎯 FIX: Handle different response formats based on endpoint
        if (endpoint === '/api/communities' || endpoint === '/api/auth/validate-session') {
          // These endpoints return raw NextJS responses - wrap in ApiResponse format
          return await this.processRawApiResponse(response);
        } else {
          // Legacy plugin endpoints already return ApiResponse format
          return await this.processResponse(response);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } else {
      const response = await fetch(url, requestOptions);
      
      // 🎯 FIX: Handle different response formats based on endpoint  
      if (endpoint === '/api/communities' || endpoint === '/api/auth/validate-session') {
        // These endpoints return raw NextJS responses - wrap in ApiResponse format
        return await this.processRawApiResponse(response);
      } else {
        // Legacy plugin endpoints already return ApiResponse format
        return await this.processResponse(response);
      }
    }
  }

  /**
   * Process API response from host service
   */
  private async processResponse(response: Response): Promise<ApiResponse> {
    if (!response.ok) {
      throw createProxyError(
        ProxyErrorType.NETWORK_ERROR,
        `HTTP ${response.status}: ${response.statusText}`
      );
    }

    let data: any;
    try {
      data = await response.json();
    } catch (error) {
      throw createProxyError(
        ProxyErrorType.INVALID_RESPONSE,
        'Invalid JSON response from API'
      );
    }

    // Validate response structure
    if (typeof data !== 'object' || data === null) {
      throw createProxyError(
        ProxyErrorType.INVALID_RESPONSE,
        'Invalid response format from API'
      );
    }

    return data;
  }

  /**
   * Process raw API response from NextJS endpoints and wrap in ApiResponse format
   */
  private async processRawApiResponse(response: Response): Promise<ApiResponse> {
    if (!response.ok) {
      throw createProxyError(
        ProxyErrorType.NETWORK_ERROR,
        `HTTP ${response.status}: ${response.statusText}`
      );
    }

    let rawData: any;
    try {
      rawData = await response.json();
    } catch (error) {
      throw createProxyError(
        ProxyErrorType.INVALID_RESPONSE,
        'Invalid JSON response from API'
      );
    }

    // Validate response structure
    if (typeof rawData !== 'object' || rawData === null) {
      throw createProxyError(
        ProxyErrorType.INVALID_RESPONSE,
        'Invalid response format from API'
      );
    }

    // 🎯 CRITICAL FIX: Wrap raw data in ApiResponse format
    return {
      success: true,
      data: rawData
    };
  }

  /**
   * Send successful response back to client
   */
  private sendSuccessResponse(source: Window, requestId: string, response: ApiResponse): void {
    const message = createProxyResponse(requestId, response);
    source.postMessage(message, '*');

    if (this.config.debug) {
      console.log('[ApiProxyServer] Success response sent:', {
        requestId,
        success: response.success
      });
    }
  }

  /**
   * Send error response back to client
   */
  private sendErrorResponse(source: Window, requestId: string, error: any): void {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const response: ApiResponse = {
      success: false,
      error: errorMessage
    };

    const message = createProxyResponse(requestId, response);
    source.postMessage(message, '*');

    if (this.config.debug) {
      console.log('[ApiProxyServer] Error response sent:', {
        requestId,
        error: errorMessage
      });
    }
  }

  /**
   * Get proxy server status
   */
  public getStatus(): ProxyServerStatus {
    return {
      isInitialized: this.isInitialized,
      serverId: this.config.serverId,
      baseUrl: this.config.baseUrl,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      startTime: this.startTime,
      lastRequestTime: this.lastRequestTime
    };
  }

  /**
   * Destroy the proxy server
   */
  public destroy(): void {
    // Remove message listener
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }

    this.isInitialized = false;

    if (this.config.debug) {
      console.log('[ApiProxyServer] Destroyed');
    }
  }
} 