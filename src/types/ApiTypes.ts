/**
 * API Types - Shared interfaces for all API operations
 * 
 * These types match the existing host service API structure
 * and ensure type safety across the proxy system.
 */

/**
 * Base API request interface (legacy - kept for backward compatibility)
 */
export interface ApiRequest {
  method: string;
  params?: Record<string, any>;
  userId: string;
  communityId: string;
  signature?: string;
}

/**
 * Base API response interface
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// =============================================================================
// 🚀 NEW: Flexible Request System
// =============================================================================

/**
 * Plugin-style request (similar to legacy ApiRequest but more explicit)
 */
export interface PluginRequest {
  type: 'plugin';
  method: string;
  params?: Record<string, any>;
  userId: string;
  communityId: string;
  signature?: string;
}

/**
 * Direct HTTP API request for any endpoint
 */
export interface DirectApiRequest {
  type: 'direct';
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

/**
 * Union type for all proxy request types
 */
export type ProxyRequest = PluginRequest | DirectApiRequest;

/**
 * Options for convenience request methods
 */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

// =============================================================================
// 🔄 EXISTING: Legacy Plugin API Types (unchanged for compatibility)
// =============================================================================

/**
 * API method types that can be proxied
 */
export type ApiMethod = 
  | 'getUserInfo'
  | 'getUserFriends'
  | 'getContextData'
  | 'getCommunityInfo'
  | 'giveRole'
  | 'getUserCommunities'  // 🆕 NEW - For sidebar community list
  | 'getUserProfile';     // 🆕 NEW - For sidebar user profile

/**
 * API endpoint mapping
 */
export const API_ENDPOINTS: Record<string, string> = {
  getUserInfo: '/api/user',
  getUserFriends: '/api/user',
  getContextData: '/api/user',
  getCommunityInfo: '/api/community',
  giveRole: '/api/community',
  getUserCommunities: '/api/communities',        // 🆕 Maps to GET /api/communities
  getUserProfile: '/api/auth/validate-session'   // 🆕 Maps to POST /api/auth/validate-session
};

/**
 * User API method types
 */
export interface GetUserInfoRequest extends ApiRequest {
  method: 'getUserInfo';
}

export interface GetUserFriendsRequest extends ApiRequest {
  method: 'getUserFriends';
  params: {
    limit?: number;
    offset?: number;
  };
}

export interface GetContextDataRequest extends ApiRequest {
  method: 'getContextData';
}

/**
 * Community API method types
 */
export interface GetCommunityInfoRequest extends ApiRequest {
  method: 'getCommunityInfo';
}

export interface GiveRoleRequest extends ApiRequest {
  method: 'giveRole';
  params: {
    roleId: string;
    userId: string;
  };
}

/**
 * Authentication API method types
 */
export interface GetUserCommunitiesRequest extends ApiRequest {
  method: 'getUserCommunities';
  params?: { 
    sessionToken: string;  // Required for authentication
  };
}

export interface GetUserProfileRequest extends ApiRequest {
  method: 'getUserProfile';
  params?: { 
    sessionToken: string;  // Required for authentication
  };
}

/**
 * Union type for all API requests
 */
export type ApiRequestUnion = 
  | GetUserInfoRequest
  | GetUserFriendsRequest
  | GetContextDataRequest
  | GetCommunityInfoRequest
  | GiveRoleRequest
  | GetUserCommunitiesRequest  // 🆕 NEW
  | GetUserProfileRequest;     // 🆕 NEW

/**
 * Helper function to get API endpoint for a method
 */
export function getEndpointForMethod(method: ApiMethod): string {
  const endpoint = API_ENDPOINTS[method];
  if (!endpoint) {
    throw new Error(`Unknown API method: ${method}`);
  }
  return endpoint;
}

/**
 * Helper function to validate API request
 */
export function validateApiRequest(request: ApiRequest): request is ApiRequestUnion {
  return !!(
    request.method &&
    request.userId &&
    request.communityId &&
    API_ENDPOINTS[request.method]
  );
} 

// =============================================================================
// 🚀 NEW: Validation Functions for Flexible Request System
// =============================================================================

/**
 * Validate plugin-style request
 */
export function validatePluginRequest(request: any): request is PluginRequest {
  return !!(
    request &&
    request.type === 'plugin' &&
    request.method &&
    request.userId &&
    request.communityId &&
    API_ENDPOINTS[request.method]
  );
}

/**
 * Validate direct API request
 */
export function validateDirectApiRequest(request: any): request is DirectApiRequest {
  return !!(
    request &&
    request.type === 'direct' &&
    request.url &&
    typeof request.url === 'string'
  );
}

/**
 * Validate any proxy request type
 */
export function validateProxyRequest(request: any): request is ProxyRequest {
  if (!request || typeof request !== 'object') {
    return false;
  }
  
  if (request.type === 'plugin') {
    return validatePluginRequest(request);
  } else if (request.type === 'direct') {
    return validateDirectApiRequest(request);
  }
  
  return false;
}

/**
 * Convert legacy ApiRequest to PluginRequest
 */
export function convertLegacyRequest(legacyRequest: ApiRequest): PluginRequest {
  const converted: PluginRequest = {
    type: 'plugin',
    method: legacyRequest.method,
    userId: legacyRequest.userId,
    communityId: legacyRequest.communityId
  };
  
  // Only include optional properties if they're defined
  if (legacyRequest.params !== undefined) {
    converted.params = legacyRequest.params;
  }
  if (legacyRequest.signature !== undefined) {
    converted.signature = legacyRequest.signature;
  }
  
  return converted;
} 