import type { AWS } from '@serverless/typescript';

const serverlessConfiguration: AWS = {
	service: 'serverless-test',
	frameworkVersion: '2',
	provider: {
		name: 'aws',
		runtime: 'nodejs12.x',
	},
	functions: {
		hello: {
			handler: 'handler.default',
			// handler: './src/main.default',
			events: [
				{
					http: {
						method: 'any',
						path: '/cpf',
					}
				},
				{
					http: {
						method: 'any',
						path: '/cpf/{proxy+}',
					}
				}
			],
		},
	},
	plugins: [
		'serverless-offline',
	],

}

module.exports = serverlessConfiguration;