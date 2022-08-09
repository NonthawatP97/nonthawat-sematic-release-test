import { KolpError } from 'kolp/lib/cjs/utils/error.http'
import { ClientErrorCode, ServerErrorCode } from 'kolp/lib/cjs/utils/response';

export type GeneralErrorCode =
  /**
   * Resource cannot be found.
   */
  |'RES-001 RESOURCE_NOT_FOUND'
  /**
   * เกิดขอผิดพลาดกับตัวข้อมูล เช่นข้อมูลซ้ำ
   */ 
  |'RES-002 RESOURCE_ALREADY_EXISTS'
  /**
   * Requesting invalid resource scope.
   */
  |'RES-003 INVALID_RESOURCE_SCOPE'
  /**
   * Requesting to query data with invalid or bad pattern.
   */
  |'RES-004 QUERY_MALFORM'
  /**
   * Backend's fault; Mismatch or invalid controller configuration.
   */
  |'RES-005 BAD_CONTROLLER_CONFIGURATION'
  /**
   * Requesting update with invalid or bad body.
   */
  |'RES-006 UPDATE_MALFORM'
  /**
   * Requesting delete many resource with invalid or bad request pattern.
   */
  |'RES-007 DELETE_MANY_MALFORM'
  /**
   * Requesting to update via Batch file contain invalid or bad data payload.
   */
  |'RES-008 BATCH_UPDATE_MALFORM'
  /**
   * Requesting to update via Batch file contain invalid or bad data payload.
   */
   |'RES-009 DELETE_PARENT_ROW'

export type BannerErrorCode =
  'BANNER-001 BANNER_INFO_ITEMS_MUST_NOT_BE_NULL'

export type AppointmentErrorCode = 
  /**
   * Request to create duplicate appointment in 24 hrs 
   */
  'APPOINTMENT-001 APPOINTMENT_IS_PROCESSING'

export type RegistrationCode = 
  /**
   * Request to create duplicate registration
   */
  'REGISTRATION-001 REGISTRATION_IS_DUPLICATED'
  /**
   * Request to update registration but email/telephone is already exists
   */
  |'REGISTRATION-002 EMAIL_OR_TELEPHONE_ALREADY_EXISTS'
  /**
   * Request to update registration but status is pending
   */
  |'REGISTRATION-003 REGISTRATION_IS_PENDING'

export type ErrorCode = GeneralErrorCode
| BannerErrorCode
| AppointmentErrorCode

export class ServiceError extends KolpError {

  static fromUserInput(code: ClientErrorCode, message: ErrorCode | string, data?: any): KolpError {
    return new KolpError(code, message, data)
  }

  static fromServer(code: ServerErrorCode, message: ErrorCode | string, data?: any): KolpError {
    return new KolpError(code, message, data)
  }
}