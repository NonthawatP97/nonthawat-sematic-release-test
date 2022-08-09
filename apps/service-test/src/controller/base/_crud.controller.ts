import type { KolpServiceContext } from 'kolp'
import { Collection, Populate, QueryFlag, Utils, wrap } from '@mikro-orm/core'

import { BaseRoutedController, RouteMap } from 'kolp'
import { EntityManager } from '@mikro-orm/mysql-base'
import { QueryOperator, QueryOrderMap } from '@mikro-orm/core'
import { fromPairs, map, values, toPairs, pick } from 'lodash'

export class CrudError extends Error {
  private constructor(type: string, resource: string, detail: string) {
    super(`${type}: ${resource}: ${detail}`)
  }

  static coded(type: string, resource: string, detail: string) {
    return new CrudError(type, resource, detail)
  }
}

export interface CrudControllerOption<E> {

  /**
   * Calculate an ObjectLiteral to produce where condition for every request.
   * 
   * Where object should matched the criteria that is needed.
   * 
   * This will acting as scope limitation.
   */
  forAllResources: ((ctx: KolpServiceContext) => Partial<{ [key in keyof E]: any }>)

  /**
   * Searchable fields
   */
  searchableFields: (keyof E)[]

  /**
   * Searchable field should be converted
   */
  searchableFieldValueConverter: Partial<{ [key in keyof E]: (raw: any) => string }>

  /**
   * Sorting options
   */
  orderBy: QueryOrderMap

  /**
   * Load a resource for create method.
   * 
   * This method will replace basic default constructor upon resource creation.
   */
  loadResourceToCreate: ((ctx: KolpServiceContext) => Promise<E|undefined>)

  /**
   * if not provided. Meaning there if only one resource in provided scope.
   * 
   * Create method will become update method.
   * Delete method will become disabled.
   * 
   * Possible value:
   *  - `:paramName<entityFieldName>`
   *  - `:paramNameAndColumnName`
   */
  resourceKeyPath: string
  /**
   * Default populate options
   * - one = use when populate select one
   * - many = use when populate select many
   */
  defaultPopulate: (ctx: KolpServiceContext, isMany: boolean) => Populate<E>

  /**
   * Process input
   */
  sanitizeInputBody: (ctx: KolpServiceContext, em: EntityManager, body: any, isCreating: boolean) => Promise<any>

  /**
   * Hook that will apply to all objects loaded.
   */
  afterLoad: ((ctx: KolpServiceContext, objects: E[]) => Promise<E[]>)[]

  /**
   * Hook that should never throw Error.
   */
  preSave: ((ctx: KolpServiceContext, em: EntityManager, object: E, isCreating: boolean) => Promise<E>)[]

  /**
   * Hook to tune 
   */
  postSave: ((ctx: KolpServiceContext, em: EntityManager, object: E, isCreating: boolean) => Promise<E>)[]

  /**
   * Hook before destructive operation
   */
  preDelete: ((ctx: KolpServiceContext, em: EntityManager, objects: E[]) => Promise<E[]>)[]

  /**
   * Hook after destructive operation
   */
  postDelete: ((ctx: KolpServiceContext, em: EntityManager, deletedObjects: E[]) => Promise<void>)[]

  /**
   * Use _ as empty value
   * 
   * Replace /^_$/ with '' value in keypath
   * 
   * Use this option to avoid empty value in key path.
   */
  replaceUnderscrollWithEmptyKeyPath: boolean

  /**
   * enable middleware check permissions of user
   * 
   * use only key of permission
   * 
   * example : `read-user` => send only `user` in this option
   */
  permissionKeys: string[]

  /**
   * example : if admin has write-customer, admin can read role
   * send read-role permission in this field
   */
  permissionsSubstitute: string[]

  /**
   * set FindOptions { [flags]: [QueryFlag.DISTINCT] } on index
   * 
   * You dont have to use QueryFlag.DISTINCT if you are not joining anything, 
   * these is a flag that will set distinct on main query. issues when 
   * you also join to-many relations that will produce more rows in the end result.
   */
  setFlagDistinct: boolean
}

export class CrudController<E> extends BaseRoutedController {

  private options: CrudControllerOption<E>

  protected resolvedResourcePath: string

  constructor(private cnstr: new () => E, public readonly resourceName: string, options: Partial<CrudControllerOption<E>>) {
    super()
    this.resolvedResourcePath = (options.resourceKeyPath || ':id').replace(/^\/?/, '/') // attach leading '/' if not provided.
    this.options = {
      forAllResources: () => ({}),
      loadResourceToCreate: () => undefined,
      sanitizeInputBody: async (ctx, em, body) => body,
      searchableFields: [],
      searchableFieldValueConverter: {},
      orderBy: { updatedAt: 'desc' },
      afterLoad: [],
      preSave: [],
      postSave: [],
      preDelete: [],
      postDelete: [],
      defaultPopulate: () => [],
      replaceUnderscrollWithEmptyKeyPath: false,
      permissionKeys: [],
      permissionsSubstitute: [],
      setFlagDistinct: false,
      ...options,
      resourceKeyPath: this.resolvedResourcePath.replace(/<\w+>/g, ''), // removed <columnName> component
    }
  }

  protected getEntityManager(context: KolpServiceContext): EntityManager {
    return context.em as EntityManager
  }

  public getRouteMaps(): RouteMap {
    let writeMiddlewares = []
    let readMiddlewares = []
    writeMiddlewares = this.options.permissionKeys.length > 0 ? writeMiddlewares : writeMiddlewares
    readMiddlewares = this.options.permissionKeys.length > 0 ? readMiddlewares : readMiddlewares
    return {
      ...super.getRouteMaps(),
      index: { method: 'get', path: '/', middlewares: readMiddlewares },
      createOne: { method: 'post', path: '/', middlewares: writeMiddlewares },
      getOne: { method: 'get', path: this.options.resourceKeyPath, middlewares: readMiddlewares },
      updateOne: { method: 'post', path: this.options.resourceKeyPath, middlewares: writeMiddlewares },
      deleteOne: { method: 'delete', path: this.options.resourceKeyPath, middlewares: writeMiddlewares },
    }
  }

  /**
   * Create a single record.
   * @param context
   */
  public async createOne(context: KolpServiceContext): Promise<E> {
    const body = context.request.body
    if (!body) {
      throw CrudError.coded('RES-006 UPDATE_MALFORM', this.resourceName, 'Empty update body, nothing to update!')
    }
    if (typeof body === 'string') {
      throw CrudError.coded('RES-006 UPDATE_MALFORM', this.resourceName, 'expected JSON body.')
    }

    const allReq = this.options.forAllResources(context)
    const preloadInstance = await this.options.loadResourceToCreate(context)
    let raw = preloadInstance || new this.cnstr()

    return await this.getEntityManager(context)
      .transactional(async (t): Promise<E> => {

        const sanitizedBody = await this.options.sanitizeInputBody(context, t, body, true)
        raw = wrap(raw).assign({
          ...sanitizedBody,
          ...allReq,
        }, { em: t })

        const validator = (this.cnstr as any).validate
        if (validator) {
          await validator(raw)
        }

        // Apply preSave hook
        for (const h of this.options.preSave) {
          raw = await h(context, t, raw, true)
        }

        // Save
        t.persist(raw)

        // Apply postSave hook
        for (const h of this.options.postSave) {
          raw = await h(context, t, raw, true)
        }

        await t.flush()

        return raw
      })
  }

  public async getOne(context: KolpServiceContext, manager?: EntityManager): Promise<E> {
    const query = context.request.query
    const hasPopulate = Boolean(query.populate)
    const populatedByQuery = (typeof query.populate === 'string' ? query.populate.split(',') : (query.populate || [])).filter(Boolean)

    const where = {
      ...this._forKeyPath(context),
      ...this.options.forAllResources(context),
    }
    console.log('where',where)

    let r: E | undefined = undefined
    const em = manager || this.getEntityManager(context)
    r = await em.findOne(this.cnstr, where, {
      cache: 200,
       populate: hasPopulate
        ? populatedByQuery
        : this.options.defaultPopulate(context, false),
    }) as E

    if (!r) {
      throw CrudError.coded('RES-001 RESOURCE_NOT_FOUND', this.resourceName, `query=${JSON.stringify(where)}`)
    }

    let rarray = [r]
    for (const h of this.options.afterLoad) {
      rarray = await h(context, rarray)
    }

    if (rarray.length !== 1) {
      throw CrudError.coded('RES-005 BAD_CONTROLLER_CONFIGURATION', this.resourceName, 'Internal hooks might not returned promised objects. Please check afterLoad hooks.')
    }

    return r
  }

  /**
   * Update a single record.
   * @param context
   */
  public async updateOne(context: KolpServiceContext): Promise<E> {
    const body = context.request.body
    if (!body) {
      throw CrudError.coded('RES-006 UPDATE_MALFORM', this.resourceName, 'Empty update body, nothing to update!')
    }

    return await this.getEntityManager(context)
      .transactional(async (t): Promise<E> => {
        let raw = await this.getOne(context, t)

        const sanitizedBody = await this.options.sanitizeInputBody(context, t, body, false)
        //@ts-ignore
        raw = this.__processUpdatePayload(t, raw, sanitizedBody)

        // Apply preSave hook
        for (const h of this.options.preSave) {
          raw = await h(context, t, raw, false)
        }

        // Save
        t.persist(raw)

        // Apply postSave hook
        for (const h of this.options.postSave) {
          raw = await h(context, t, raw, false)
        }

        await t.flush()

        return raw
      })
  }

  /**
   * Delete requested resource by get the existing one first?
   * @param context 
   */
  public async deleteOne(context: KolpServiceContext): Promise<void> {
    return await this.getEntityManager(context)
    .transactional(async (t): Promise<void> => {
        const r = await this.getOne(context, t)

        let deleteEntries = [r]
        for (const h of this.options.preDelete) {
          //@ts-ignore
          deleteEntries = await h(context, t, deleteEntries)
        }

        // Actually delete it
        for (const e of deleteEntries) {
          await t.removeAndFlush(e)
        }

        for (const h of this.options.postDelete) {
          await h(context, t, deleteEntries)
        }
      })
  }

  /**
   * 
   */
  public async index(context: KolpServiceContext): Promise<{ count: number, items: E[] }> {
    const query = context.request.query
    const offset = +(query['offset'] || 0)
    const pageSize = +(query['pagesize'] || 20)
    const hasPopulate = Boolean(query.populate)
    const populatedByQuery = (typeof query.populate === 'string' ? query.populate.split(',') : (query.populate || [])).filter(Boolean)

    const em = this.getEntityManager(context)

    const smartWhereClause = {
      ...this.options.forAllResources(context),
      '$and': [
        ...this._whereClauseByQuery(context),
      ]
    }
    console.log('where',smartWhereClause)

    // Create Query conditions
    let [items, count] = await em.findAndCount(this.cnstr,
      smartWhereClause as any,
      {
        limit: pageSize,
        offset: offset,
        orderBy: this._orderBy(context),
        populate: hasPopulate
          ? populatedByQuery
          : this.options.defaultPopulate(context, true),
        flags: this.options.setFlagDistinct 
          ? [QueryFlag.DISTINCT] 
          : [],
      })

    // Apply afterLoad hooks
    for (const h of this.options.afterLoad) {
      items = await h(context, items)
    }
    
    return {
      count,
      items,
    }
  }

  /* PRIVATE METHODS */

  /**
   * Extract orderBy from incoming `context.request.query`.
   * @param context 
   */
  private _orderBy(context: KolpServiceContext): QueryOrderMap {
    const req = context.request
    if (req.query.order) {
      const order = req.query.order as string
      const orders = order.split(',')
      console.log("order",order)
      return orders
        .reduce((c, element): QueryOrderMap => {
          const m = element.match(/^([^ ]+)(\s+(asc|desc))?$/)
          if (!m) throw CrudError.coded('RES-004 QUERY_MALFORM', this.resourceName, 'order MUST has following format `db_field_name_1 asc,db_field_name2,db_field_name_3 desc`')
          return { ...c, [m[1]]: (m[2]?.toLowerCase() ?? 'desc') as any }
        }, {})
    }
    return this.options.orderBy
  }

  private _whereClauseByQuery(context: KolpServiceContext): (Partial<{ [key in keyof E]: Partial<{ [key in QueryOperator]: any }> }>[]) {
    const req = context.request
    // const scopes = get(this.cnstr, 'scope', get(this.cnstr, 'scopes', {}))
    // const scopeName = get(req.query, 'scope', '') as string

    // Validate scope object
    // if (!!scopeName && !(scopeName in scopes)) {
    //   throw ServiceError.coded('RES-003 INVALID_RESOURCE_SCOPE', { resource: this.resourceName, scopeName, scopes })
    // }
    // q = { key: value }
    const q: { [key: string]: string | string[] } = {
      // ...pick(scopes, scopeName, {} as any),
      ...pick(req.query, this.options.searchableFields),
    }

    const evalValue = (val: string): string => {
      if (/\$dt\(1[0-9]+\)/.test(val)) {
        const m = val.match(/\$dt\((.+)\)/)
        if (!m) throw CrudError.coded('RES-004 QUERY_MALFORM', this.resourceName, 'failed to evalQuery $dt')
        return new Date(+m[1]).toISOString()
      }
      return val
    }
    /**
     * Supported format
     * 
     * - Between Operator: `$between(v1, v2)`
     * - Date Operator: `$dt(milliseconds)`
     * - In Operator: `$in(value split by comma)`
     * 
     * @param v
     */
    const evalQuery = (v: string): (Partial<{ [key: string]: any }>) | 'void' => {
      if (/\$between\((\d+),(\d+)\)/i.test(v)) {
        const m = v.match(/\$between\(([^,]+),(.+)\)/i)
        if (!m) throw CrudError.coded('RES-004 QUERY_MALFORM', this.resourceName, 'failed to evalQuery $between')
        // return [{ [QueryOperator.$lte]: +m[1] }, { [QueryOperator.$gte]: +m[2] }]
        return { $gte: +m[1], $lte: +m[2] }
      } else if (/\$like\(([^)]*)\)/i.test(v)) {
        const m = v.match(/\$like\(([^)]*)\)/i)
        if (!m) throw CrudError.coded('RES-004 QUERY_MALFORM', this.resourceName, 'failed to evalQuery $like')
        // return [`LIKE (:${_pk})`, {
        //   [_pk]: m[1]
        // }]
        return { $like: m[1] }
      } else if (/\$between\(([^,]+),(.+)\)/i.test(v)) {
        const m = v.match(/\$between\(([^,]+),(.+)\)/i)
        if (!m) throw CrudError.coded('RES-004 QUERY_MALFORM', this.resourceName, 'failed to evalQuery $between')
        // return [`BETWEEN :${paramKeyFrom} AND :${paramKeyTo}`, {
        //   [paramKeyFrom]: evalValue(m[1]), 
        //   [paramKeyTo]: evalValue(m[2])
        // }]
        return { $gte: evalValue(m[1]), $lte: evalValue(m[2]) }
      } else if (/\$in\([^)]+\)/i.test(v)) {
        const m = v.match(/\$in\(([^)]+)\)/i)
        if (!m) throw CrudError.coded('RES-004 QUERY_MALFORM', this.resourceName, 'failed to evalQuery $in')
        const splitted = m[1].split(',').filter((o) => !!o)
        if (splitted.length > 0) {
          // return [`IN (:...${_pk})`, {
          //   [_pk]: splitted
          // }]
          return { $in: splitted }
        }
        return 'void'
      } else if (/\$gt\([^)]+\)/i.test(v)) {
        const m = v.match(/\$gt\(([^)]+)\)/i)
        if (!m) throw CrudError.coded('RES-004 QUERY_MALFORM', this.resourceName, 'failed to evalQuery $gt')
        // return [`>= :${gtPk}`, {
        //   [gtPk]: evalValue(m[1])
        // }]
        return { $gt: evalValue(m[1]) }
      } else if (/\$lt\([^)]+\)/i.test(v)) {
        const m = v.match(/\$lt\(([^)]+)\)/i)
        if (!m) throw CrudError.coded('RES-004 QUERY_MALFORM', this.resourceName, 'failed to evalQuery $lt')
        // return [`<= :${ltPk}`, {
        //   [ltPk]: evalValue(m[1])
        // }]
        return { $lt: evalValue(m[1]) }
      } else if (/\$null/i.test(v)) {
        return { $eq: null }
      } else if (/\$nenull/i.test(v)) {
        return { $ne: null }
      } else if (/\$bool\((true|1|yes|false|no|0)\)/i.test(v)) {
        const m = v.match(/\$bool\((true|1|yes|false|no|0)\)/i)
        if (/true|1|yes/.test(m[1])) {
          return { $eq: 1}
        }
        return { $eq: 0 }
      }
      // return [`= :${defaultPk}`, {
      //   [defaultPk]: evalValue(v)
      // }]
      return { $eq: evalValue(v) }
    }

    /**
     * {
     *  [fieldName]: {
     *    [key in QueryOperator]: any,
     *    ...
     *  }
     * }
     */
    const res = toPairs(q).map(([key, v]): Partial<{ [key in keyof E]: Partial<{ [key in QueryOperator]: any }> }> => {
      if (typeof v === 'function') throw CrudError.coded('RES-004 QUERY_MALFORM', this.resourceName, 'Cannot evaluate value as function.')
      const _v = this.options.searchableFieldValueConverter[key] ? this.options.searchableFieldValueConverter[key](v) : v
      const val = evalQuery(_v)
      return (val === 'void') ? {} : { [key]: val } as any
    })
    return res
  }

  /**
   * Return keyPair mapping of URL parameters.
   * 
   * Format:
   * 
   * ```
   *  :paramName(regex)<columnName>
   * 
   * or
   *  :paramName(regex)              => columnName = paramName
   * 
   * or
   *  :paramName<columnName>         => regEx = ([A-Za-z0-9_]{0,})       // ** based on Express document.
   * ```
   */
  protected get paramsToColumnNamePairs(): { columnName: string; paramName: string, pattern: string }[] {
    const matchedPaths = this.resolvedResourcePath.match(/:(\w+)(\([^)]*\))?(<\w+>)?/g)
    return (matchedPaths || []).reduce<{ columnName: string; paramName: string, pattern: string }[]>((c, str) => {
      const r = str.match(/:(\w+)(\([^)]*\))?(<(\w+)>)?/)
      if (!r) throw CrudError.coded('RES-005 BAD_CONTROLLER_CONFIGURATION', this.resourceName, 'failed to parse/convert columnNamePairs. Check your controller\'s request path pattern.' )
      c.push({
        paramName: r[1],
        columnName: r[4] || r[1],
        pattern: r[2] || '([A-Za-z0-9_]{0,})'
      })
      return c
    }, [])
  }

  private _forKeyPath(context: KolpServiceContext): Partial<{ [key in keyof E]: any }> {
    const valueGetter = !this.options.replaceUnderscrollWithEmptyKeyPath 
      ? (paramName: string) => context.params[paramName]
      : (paramName: string) => (context.params[paramName] || '').replace(/^_$/, '')
    
    return this.paramsToColumnNamePairs.reduce((c, p) => {
      c[p.columnName] = valueGetter(p.paramName)
      return c
    }, {})
  }

  private __processUpdatePayload(em: EntityManager, obj: E, payload: any): E {
    const parentEntity: any = obj
    const cnstr = this.cnstr
    for (const key in parentEntity) {
      if (!Object.prototype.hasOwnProperty.call(parentEntity, key)) {
        continue
      }
      // Process collection items so that assign can work through managed/unmanaged complications
      const meta = em.getMetadata().find(cnstr.name)
      const relationshipForThisKey = meta.relations.find((o) => o.name === key)
      const primaryKeysForCollectionElement = relationshipForThisKey?.targetMeta?.primaryKeys
      if (parentEntity[key] instanceof Collection && payload[key] instanceof Array && relationshipForThisKey && primaryKeysForCollectionElement) {
        // const parentKey = relationshipForThisKey.mappedBy
        const elementMeta = em.getMetadata().find(relationshipForThisKey.type)
        const fromDb = parentEntity[key] as Collection<any>
        const fromPayload = payload[key] as Array<any>
        // Go through each existing objects.
        const toRemove = fromPairs(map(fromDb, (o) => [Utils.getCompositeKeyHash(o, elementMeta), o]))
        console.log('Computing changes', JSON.stringify(fromPayload, null, ' '), 'against', JSON.stringify(fromDb))
        for (let i = 0; i < fromPayload.length; i++) {
          // Creation case
          const found = em.getUnitOfWork().tryGetById(relationshipForThisKey.type, {
            ...pick(fromPayload[i], ...primaryKeysForCollectionElement),
            // TODO: Need to check why filter with forign key not work!
            //[parentKey]: parentEntity,
          })
          if (found) {
            // mark dirty
            console.log('UPDATE CASE -- FOUND', found, 'marking dirty with =>', fromPayload[i])
            wrap(found).assign(fromPayload[i], { em })
            delete toRemove[Utils.getCompositeKeyHash(found, elementMeta)]
          } else {
            console.log('CREATION CASE -- NOT FOUND > add new one =>', fromPayload[i])
            // Add new ones
            const unmanaged = em.create(relationshipForThisKey.type, fromPayload[i])
            fromDb.add(unmanaged)
          }
        }
        console.log('FINALLY -- DELETE THE REST', toRemove)
        // Removals
        fromDb.remove(...values(toRemove))
        // remove this from payload to assign to object.
        delete payload[key]
      }
    }

    em.assign(obj, payload)
    return obj
  }
}