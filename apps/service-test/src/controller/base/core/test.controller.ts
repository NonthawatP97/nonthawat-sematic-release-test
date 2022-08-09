import { TodoEntity } from '/home/nonthawat/workshop/kolp-test/apps/service-test/src/db/entities/TestEntity';
import { Route, KolpServiceContext } from 'kolp'
import { CrudController } from "../_crud.controller";

export class TodoController extends CrudController<TodoEntity>{
	constructor() {
		super(TodoEntity, 'todo', {
			resourceKeyPath: ':id'
		})
	}

	@Route('get', '/todo-test')
	async todotest(ctx: KolpServiceContext) {
		const body = ctx.request.body
		return "test-semantic"
	}
}