# 第三方依赖说明

项目按 MIT 许可证发布，见仓库根目录 LICENSE。下表依据当前直接依赖的软件包元数据整理；具体使用、再分发及声明义务以各包随附许可证为准。开发依赖不等同于随网页分发的运行时组件，最终分发范围应结合构建产物核对。

| 软件包                    | 锁定版本     | 包声明的许可证    |
| ------------------------- | ------------ | ----------------- |
| @cloudflare/vite-plugin   | 1.37.1       | MIT               |
| @eslint/js                | 9.39.4       | MIT               |
| @next/eslint-plugin-next  | 16.2.6       | MIT               |
| @tailwindcss/postcss      | 4.2.1        | MIT               |
| @types/node               | 22.19.19     | MIT               |
| @types/react              | 19.2.14      | MIT               |
| @types/react-dom          | 19.2.3       | MIT               |
| @vitejs/plugin-react      | 6.0.2        | MIT               |
| @vitejs/plugin-rsc        | 0.5.26       | MIT               |
| drizzle-kit               | 0.31.10      | MIT               |
| drizzle-orm               | 0.45.2       | Apache-2.0        |
| eslint                    | 9.39.4       | MIT               |
| eslint-plugin-jsx-a11y    | 6.10.2       | MIT               |
| eslint-plugin-react       | 7.37.5       | MIT               |
| eslint-plugin-react-hooks | 7.1.1        | MIT               |
| globals                   | 16.4.0       | MIT               |
| react                     | 19.2.6       | MIT               |
| react-dom                 | 19.2.6       | MIT               |
| react-server-dom-webpack  | 19.2.6       | MIT               |
| tailwindcss               | 4.2.1        | MIT               |
| typescript                | 5.9.3        | Apache-2.0        |
| typescript-eslint         | 8.59.3       | MIT               |
| vinext                    | 1.0.0-beta.2 | MIT               |
| vite                      | 8.0.13       | MIT               |
| wrangler                  | 4.92.0       | MIT OR Apache-2.0 |

传递依赖记录在 package-lock.json 中。交存第一方应用源程序时不混入 node_modules 或打包器生成的依赖代码；不得以软件登记为由移除依赖要求保留的声明。
