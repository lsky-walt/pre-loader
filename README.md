# Magic-Loader

### index.html
```html
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <title>react</title>
  <meta name="viewport"
    content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no">
</head>

<body>
  <div id="app">
    <!-- for loader replace -->
    {{HTML}}
    </div>
</body>

</html>
```

### webpack.config.js

```javascript

const HtmlWebPackPlugin = require("html-webpack-plugin")

...
new HtmlWebPackPlugin({
  template: `!!@lsky/magic-loader!${path.resolve(
    __dirname,
    "../index.html"
  )}`,
  filename: path.resolve(__dirname, "../dist/index.html"),
})
...
```


### entry.js
```javascript
import React from "react"
import ReactDOM from "react-dom"
import { renderToString } from "react-dom/server"
import App from "./app"

if (typeof global.document !== "undefined") {
  ReactDOM.render(<App />, document.getElementById("app"))
}

// must be app
export const app = () => {
  const html = renderToString(<App></App>)
  return html
}

```

### *Attention*

**No chunk**

**No externals**