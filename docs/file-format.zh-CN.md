# JSON 文件格式

[English](./file-format.md) | **简体中文**

Nestboard 把一张图表写成一个 JSON 文件时用的格式。用在:

- 编辑器文件菜单中的**导出到文件** / **从文件导入**
- 后端新建图表时的 `document`(见[后端说明](../server/README.md))
- 仓库里的示例(`examples/`)

格式的定义在 `frontend/src/model/types.ts`(`FileNode`、`FileEdge`、`SCHEMA_VERSION`),读取和检查在 `frontend/src/model/serialize.ts`;后端的检查规则和报错信息与它一致。

## 三种形式

同一张图表有三种形式,这个文件是其中一种:

- **文件**(本文):嵌套的树,每个框带着它的子框和连线,便于阅读和交换
- **编辑器内存中**:扁平结构(`nodes: Record<id, Node>`,每个节点记录 `parentId`),便于查找、移动、删除子树和撤销;保存和打开文件时两者互相转换
- **服务器上**:每个框、每条连线各存一行,保存时只发送改动的部分(见[后端说明](../server/README.md))

## 结构

```ts
interface Document {
  schemaVersion: number; // 当前为 5
  root: Node;
}

interface Node {
  id: string;
  title: string;
  typeId?: string;    // 框的类型(角色),如 "load-balancer";未设置即"通用"。不认识的值原样保留
  technology?: string;
  description?: string;
  position: { x: number; y: number }; // 框尺寸固定,因此不存储 size
  externals?: Record<string, { x: number; y: number }>; // 用户在这个框里面把外部框(按框 id)拖到的位置;没有的排在右侧
  children: Node[];
  edges: Edge[]; // 两端的最近公共祖先是该节点的连线(同层子节点之间,或其内部不同层级的框之间)
}

interface Edge {
  id: string;
  from: string; // 框 id(可在任意层级,但不能是另一端的祖先或后代)
  to: string;   // 框 id
  typeId?: string; // 连线类型,如 "request";未设置即"通用"。不认识的值原样保留
  label?: string;
}
```

一个最小的例子:最外层有两个框,一条连线。

```json
{
  "schemaVersion": 5,
  "root": {
    "id": "root",
    "title": "Root",
    "position": { "x": 0, "y": 0 },
    "children": [
      { "id": "web", "title": "Web app", "typeId": "client", "technology": "React",
        "position": { "x": 0, "y": 0 }, "children": [], "edges": [] },
      { "id": "api", "title": "Orders API", "typeId": "service",
        "position": { "x": 300, "y": 0 }, "children": [], "edges": [] }
    ],
    "edges": [
      { "id": "e1", "from": "web", "to": "api", "typeId": "request", "label": "Places orders" }
    ]
  }
}
```

## 规则

打开文件时会检查这些规则,不符合时整个文件不打开,并说明是哪个框或哪条连线有问题:

- 每个框、每条连线都有 `id`,在文件内不重复。`id` 是稳定的,以便将来支持"同一个框出现在多处"的引用
- 每个框都有 `title`、`position`、`children` 和 `edges`(后两者可以是空数组)
- 连线的两端都必须是文件中的框;一个框不能连到自己,也不能连到它的祖先或后代
- 连线存在两端的最近公共祖先里;存错位置的连线视为错误
- `typeId` 可以是任何非空字符串:认识的按类型显示,不认识的(例如更新版本的类型)按"通用"显示,但保存时原样保留
- `technology` 不检查是否在类型的技术清单中:清单只限制界面上的选择
- `externals` 里指向文件中不存在的框的位置会被丢弃
- 不认识的字段会被丢弃,不会写回

## 版本

`schemaVersion` 每次格式有变化就加一。到目前为止,每个版本都只是在前一个版本上**增加**内容,所以版本 1–5 的文件都能直接打开;打开后按当前版本保存。

| 版本 | 新增 |
|---|---|
| 1 | 嵌套的框和同层框之间的连线 |
| 2 | 框的类型(`Node.typeId`) |
| 3 | 跨层级的连线(连线存在两端的最近公共祖先里) |
| 4 | 连线的类型(`Edge.typeId`) |
| 5 | 外部框的位置(`Node.externals`) |

版本号比当前版本大的文件(由更新的 Nestboard 写出)不会打开,会提示先更新。将来如果某个版本改变了结构(而不只是增加),要在 `serialize.ts` 中为它写迁移,并在上表中说明。
