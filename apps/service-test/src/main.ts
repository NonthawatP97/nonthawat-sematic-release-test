import Koa from 'koa';
import Router from '@koa/router';
import cors from '@koa/cors'
import { TodoController } from './controller/base/core/test.controller';
import { KolpServiceState,KolpServiceContext,withJson, makeServerWithRouter} from 'kolp';
const app = new Koa();

export default makeServerWithRouter((router)=>{
	console.log("work")
	router.prefix('/cpf')
		.use(cors())
		.use(withJson())
	new TodoController().register('/todo',router)
})

console.log('Hello World!');
