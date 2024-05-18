// 全局变量
const version = '2'
var host = "localhost:8000"
const $ = layui.$;
var tableFilterParam = {}
var upfilename = null
var isUpload = false
var isKeyUp = false
var isConnected = false
var headerDefault = {
  "group": "产品组",
  "vpsname": "服务器名",
  "passwd": "密码/密钥",
  "host": "IP端口",
  "adsl_username": "拨号账号",
  "adsl_password": "拨号密码"
};
var ws = null
var timeConnect = 0;
var updateCacheDatas = {}
var csvFilename = "导出"
var bgVer = null
var servers = {
  header: null,
  data: null
};
const groups = new Set();
const functionDelay = 50
//标题栏
const cols = [
      {field: 'checkbox', type: 'checkbox', title: '选择', width: 60, templet: function(d) {
        return '<input type="checkbox" name="checkArr[]" value="'+d.id+'" title="选中" checked>'
      }},
      {field: 'id', title: 'ID', width: 60},
      {field: 'group', title: '产品组', minWidth: 120},
      {field: 'vpsname', title: '服务器名', minWidth: 160},
      {field: 'passwd', title: '密码/密钥', minWidth: 120, hide: true},
      {field: 'host', title: 'IP', width: 140},
      {field: 'port', title: '端口', width: 70, hide: true},
      {field: 'adsl_username', title: '拨号账号', minWidth: 130, hide: true},
      {field: 'adsl_password', title: '拨号密码', minWidth: 105, hide: true},
      {field: 'status', title: '状态', width: 80, templet: function(d) {
          if (d.status == '执行中') return '<font color="blue">执行中</font>';
          else if (d.status == '执行成功') return '<font color="green">'+d.status+'</font>';
          else if (d.status.indexOf('异常') != -1 || d.status == '执行错误') return '<font color="red">'+d.status+'</font>';
          return d.status;
        }
      },
      {field: 'status_code', title: '状态码', width: 90},
      {field: 'stdout', title: '正常输出', minWidth: 100, templet: function(d) {
          if (d.stdout)
          return d.stdout.replaceAll("\n", "\n<br>");
         else return d.stdout
        }
      },
      {field: 'stderr', title: '错误输出', minWidth: 100, templet: function(d) {
        if (d.stderr)
          return d.stderr.replaceAll("\n", "\n<br>");
        else return d.stderr
        }
      },
      {field: 'runTime', title: '执行时间', width: 105},
      {field: 'toolbar', title:'操作', width: 160, templet: function(d) {
        return `
        <button class="layui-btn layui-btn-xs" onclick="runCommands(this.parentElement.parentElement.getAttribute(\'value\'))">执行</button>
        <button class="layui-btn layui-btn-xs" onclick="putFiles(this.parentElement.parentElement.getAttribute(\'value\'))">上传</button>
        <button class="layui-btn layui-btn-xs" onclick="reADSLs(this.parentElement.parentElement.getAttribute(\'value\'))">拨号</button>`
      }}
    ]

// 初始化
layui.use(function () {
  let layer = layui.layer;
  let upload = layui.upload;

  layer.prompt({
    title: '请输入后端地址',
    value: host
  }, function (text, index) {
    layer.close(index)
    host = text
    ws_init()
  });

  // 渲染上传
  upload.render({
    elem: '#csv_file', // 绑定多个元素
    url: 'http://' + host + '/get_file_encoding/',
    acceptMime: 'text/csv',
    before: function (obj) {
      return checkConnected()
    },
    done: function (res) {
      csvFilename = res.filename.split(".")[0]
      let ret = Papa.parse(res.content);
      servers.header = ret.data[0]
      servers.data = ret.data.slice(1);
      csvFieldSetting()
    }
  });
  upload.render({
    elem: '#tempfile', // 绑定多个元素
    url: 'http://' + host + '/upfile/',
    choose: function (obj) {
      obj.preview(function (index, file, result) {
        upfilename = file.name
        $('#upfileTip').text("已上传文件：" + file.name + " (" + file.sizes + "）")
        $('#upfileTip').hide()
      })
    },
    before: function (obj) {
      return checkConnected()
    },
    done: function (res) {
      isUpload = true
      $('#upfileTip').show()
      layer.msg(res['msg']);
    }
  });
  upload.render({
    elem: '#keyfile', // 绑定多个元素
    url: 'http://' + host + '/upfile/',
    data: {
      "filename": "key"
    },
    before: function (obj) {
      return checkConnected()
    },
    done: function (res) {
      isKeyUp = true
      layer.msg(res['msg']);
    }
  });

});

function csvFieldSetting() {
  let selectContent = '';
  for (let i = 0, l = servers.header.length; i < l; i++) {
    selectContent += '<option value="' + i + '">' + servers.header[i] + '</option>';
  }
  const formList = []
  for (let key in headerDefault) {
    formList.push([headerDefault[key], `
                      <select name="` + key + `" required lay-verify="required">
                          ` + selectContent + `
                      </select>
      `])
  }
  formList.push(['', '<button class="layui-btn" lay-submit lay-filter="sub">提交</button>'])
  let htmlContent = '';
  formList.forEach(function (curr, index, arr) {
    htmlContent += `
              <div class="layui-form-item">
                  <label class="layui-form-label">` + curr[0] + `</label>
                  <div class="layui-input-block">
                      ` + curr[1] + `
                  </div>
              </div>
              `;
  });
  layer.open({
    type: 1,
    maxmin: true,
    resize: false,
    shadeClose: true,
    title: '字段选择',
    content: `
          <form class="layui-form" action="" enctype="multipart/form-data" lay-filter="csvForm" onsubmit="return false">
          ` + htmlContent + `
          </form>
          `,
    success: function (index) {
      let form = layui.form;
      form.render();
      form.val('csvForm', {
        'vpsname': 2,
        'group': 1,
        'host': 4,
        'passwd': 3,
        'adsl_username': 5,
        'adsl_password': 5
      })
      form.on('submit(sub)', function (data) {
        tranServers(data.field)
        layer.closeAll('page');
        return false;
      });
    }
  });
}

function tranServers(fieldMaps) {
  console.time("解析数据")
  groups.clear()
  servers.header = {
    id: "ID",
    status: "状态",
    status_code: "状态码",
    stdout: "标准输出",
    stderr: "错误输出",
    runTime: "执行时间",
  }
  Object.assign(servers.header, headerDefault)
  for (let i = 0, l = servers.data.length; i < l; i++) {
    let d = {
      id: i,
      status: "未操作",
      status_code: 0,
      stdout: "",
      stderr: "",
      runTime: ""
    }
    for (let key in headerDefault) {
      if (key == "host") {
        let ipp = matchIPPort(servers.data[i][fieldMaps[key]])
        d['host'] = ipp['ip']
        d['port'] = ipp['port']
      } else if (key == "adsl_username" || key == "adsl_password") {
        let adsl = matchADSL(servers.data[i][fieldMaps[key]])
        d['adsl_username'] = adsl['username']
        d['adsl_password'] = adsl['password']
      } else if (key == "group") {
        d["group"] = servers.data[i][fieldMaps[key]]
        groups.add(servers.data[i][fieldMaps[key]])
      } else {
        d[key] = servers.data[i][fieldMaps[key]]
      }
    }
    servers.data[i] = d
  }
  console.timeEnd("解析数据")
  // 下拉按钮测试
  let ddbData = [{
    id: "",
    title: "全部"
  }]
  for (let g of groups) {
    ddbData.push({
      id: g,
      title: g
    })
  }
  layui.dropdown.render({
    elem: '#filterGroupButton', // 可绑定在任意元素中，此处以上述按钮为例
    data: ddbData,
    // 菜单被点击的事件
    click: function (obj) {
      showGroup(obj.id)
    }
  });
  layui.dropdown.render({
    elem: '#filterStatusButton', // 可绑定在任意元素中，此处以上述按钮为例
    data: [{
      id: "",
      title: "全部"
    }, {
      id: "no",
      title: "未操作"
    }, {
      id: "ing",
      title: "执行中"
    }, {
      id: "ok",
      title: "执行成功"
    }, {
      id: "fail",
      title: "执行错误"
    }, {
      id: "err",
      title: "异常"
    }, {
      id: "fe",
      title: "错误+异常"
    }],
    // 菜单被点击的事件
    click: function (obj) {
      showStatus(obj.id)
    }
  });
  buildTable()
}

function buildTr(data) {
  let trHtml = ''
  let tdHtml = ''
  for (let col of cols) {
    if (!col.hide) {
      tdHtml = '<td'
      tdHtml += '>'
      if (col.type && col.type == 'checkbox') {
        tdHtml += '<input type="checkbox" name="checkArr[]" value="' + data.id + '" checked>'
      } else if (col.templet) {
        tdHtml += col.templet(data)
      } else if (col.field) {
        tdHtml += data[col.field]
      }
      tdHtml += '</td>'
      trHtml += tdHtml
    }
  }
  return trHtml
}

function buildTrs() {
  let trsHtml = ''
  let trHtml = ''
  for (let i = 0, l = servers.data.length; i < l; i++) {
    trHtml = '<tr name="data[' + i + ']" value="' + i + '" style="max-height: 95px;">'
    if (!servers.data[i].hide) {
      trHtml += buildTr(servers.data[i])
    }
    trHtml += '</tr>'
    trsHtml += trHtml
  }
  return trsHtml
}

function buildThs() {
  let thsHtml = ''
  for (let col of cols) {
    if (!col.hide) {
      thsHtml += '<th'
      // if (col.minWidth) {
      //   thsHtml += ' style="min-width:' + col.minWidth + ';"'
      // }
      thsHtml += '>'
      if (col.type && col.type == 'checkbox') {
        thsHtml += '<input type="checkbox" id="checkAll" checked>'
      } else {
        thsHtml += col.title
      }
      thsHtml += '</th>'
    }
  }
  return thsHtml
}



function buildCols() {
  let colsHtml = ''
  let colHtml = ''
  for (let col of cols) {
    if (!col.hide) {
      colHtml = '<col'
      if (col.width) {
        colHtml += ' width="' + col.width + '"'
      }
      colHtml += '>'
      colsHtml += colHtml
    }
  }
  return colsHtml
}

function buildTable() {
  console.time("buildTable")
  document.getElementById('serversTable').innerHTML = layui.laytpl(document.getElementById('tableTPL').innerHTML).render({
    cols: buildCols(),
    ths: buildThs(),
    trs: buildTrs()
  })
  //全选按钮
  const checkbox = document.querySelector('#checkAll');
  if (checkbox) {
    checkbox.addEventListener('change', () => {
      setChecks(checkbox.checked)
    })
  }
  console.timeEnd("buildTable")
}

function filterDatas() {
  let isHide = function (data) {
    for (let k in tableFilterParam) {
      if (k == "status") {
        if (Array.isArray(tableFilterParam[k])) {
          if (tableFilterParam[k].every(function (s) {
              return data[k].indexOf(s) === -1
            })) {
            return true
          }
        } else {
          if (data[k].indexOf(tableFilterParam[k]) === -1) {
            return true
          }
        }
      } else if (Array.isArray(tableFilterParam[k])) {
        if (tableFilterParam[k].every(function (s) {
            return data[k] != s
          })) {
          return true
        }
      } else {
        if (data[k] != tableFilterParam[k]) {
          return true
        }
      }
    }
    return false
  }

  for (let i = 0, l = servers.data.length; i < l; i++) {
    servers.data[i].hide = isHide(servers.data[i])
  }

  buildTable()
}

function getChecks() {
  let checkboxs = document.querySelectorAll('input[name="checkArr[]"][type="checkbox"]:checked');
  let l = checkboxs.length
  let checkedArr = Array(l)
  for (let i = 0; i < l; i++) {
    checkedArr[i] = checkboxs[i].value
  }
  return checkedArr
}

function setChecks(isCheck) {
  let checkboxs = document.querySelectorAll('input[name="checkArr[]"][type="checkbox"]');
  let l = checkboxs.length
  for (let i = 0, l = checkboxs.length; i < l; i++) {
    checkboxs[i].checked = isCheck;
  }
}

function updateData(id, data) {
  data.id = id
  if (servers.data[id].startTime != undefined && data.startTime == undefined) {
    servers.data[id].runTime = parseInt(performance.now() - servers.data[id].startTime) + "ms";
  }
  Object.assign(servers.data[id], data)
  document.querySelector('tr[name="data[' + id + ']"]').innerHTML = buildTr(servers.data[id])
}


function checkConnected() {
  if (!isConnected) {
    layer.alert("已与后端断开连接，请刷新网页")
    return false
  }
  return true
}

function ws_init() {
  ws = new WebSocket("ws://" + host + "/ws");
  ws.onmessage = function (event) {
    try {
      response = JSON.parse(event.data);
      parseResponse(response)
      return true;
    } catch (error) {
      return false;
    }
  };

  ws.onopen = function () {
    isConnected = true
    layer.msg('已连接到后端', {
      icon: 6
    });
  }
  ws.onclose = function (e) {
    console.log(e)
    if (isConnected) {
      isConnected = false
      layer.alert("已与后端断开连接，尝试自动重连")
      ws_reconnect();
    }
  }
  ws.onerror = function (e) {
    console.log(e)
    if (isConnected) {
      isConnected = false
      layer.alert("已与后端连接错误，尝试自动重连")
      ws_reconnect();
    }
  }
}

function ws_reconnect() {
  timeConnect++;
  console.log("WS第" + timeConnect + "次重连");
  setTimeout(function () {
    ws_init();
  }, 1000);

}

function sendJson(data) {
  if (checkConnected()) {
    ws.send(JSON.stringify(data));
  }
}

function parseResponse(ret) {
  if (ret.id !== undefined && ret.status != undefined) {
    updateData(ret.id, ret)
  } else if (ret.config !== undefined) {
    if (ret.config.version !== undefined) {
      bgVer = ret.config.version
    }
  }
}

function setPasswds() {
  if (!checkConnected()) {
    return
  }
  let checks = getChecks()
  if (checks.length != 0) {
    layer.prompt({
      title: '请输入密码，上传的密钥请输入key',
      value: "key"
    }, function (passwd, index) {
      layer.close(index);
      for (let i = 0, l = checks.length; i < l; i++) {
        servers.data[checks[i]].passwd = passwd
      }
      buildTable()
    });
  } else {
    layer.alert("请选中要执行的服务器")
  }
}

function reADSLs(id) {
  if (!checkConnected()) {
    return
  }
  let checks = id && [id] || getChecks()
  if (checks.length != 0) {
    layer.confirm("是否执行？", {}, function (index) {
      layer.close(index);
      setTimeout(() => reADSL(checks), functionDelay)
    });
  } else {
    layer.alert("请选中要执行的服务器")
  }
}


function runCommands(id) {
  if (!checkConnected()) {
    return
  }
  let checks = id && [id] || getChecks()
  if (checks.length != 0) {
    layer.prompt({
      title: '请输入需要执行的命令',
      formType: 2
    }, function (command, index) {
      layer.close(index);
      setTimeout(() => runCommand(checks, command), functionDelay)
    });
  } else {
    layer.alert("请选中要执行的服务器")
  }
}

function putFiles(id) {
  if (!checkConnected()) {
    return
  }
  if (!isUpload) {
    layer.msg("请先上传临时文件到后端服务器")
    return
  }
  let checks = id && [id] || getChecks()
  if (checks.length != 0) {
    layer.prompt({
      title: '请输入要上传的文件路径',
      value: upfilename
    }, function (path, index) {
      layer.close(index);
      setTimeout(() => putFile(checks, path), functionDelay)
    });
  } else {
    layer.alert("请选中要上传的服务器")
  }
}

function runCommand(ids, command) {
  if (!checkConnected()) {
    return
  }
  requestServerWs(ids, "exec", command)
}

function reADSL(ids) {
  if (!checkConnected()) {
    return
  }
  requestServerWs(ids, "adsl", "")
}

function putFile(ids, path) {
  if (!checkConnected()) {
    return
  }
  requestServerWs(ids, "put", path)
}

// 请求操作
function requestServerWs(ids, mode, param) {
  if (Array.isArray(ids)) {
    for (let i = 0, l = ids.length; i < l; i++) {
      let data = servers.data[ids[i]]
      Object.assign(data, {
        status: "执行中",
        startTime: performance.now()
      })
    }
    buildTable()
    for (let i = 0, l = ids.length; i < l; i++) {
      let data = servers.data[ids[i]]
      data = {
        id: data.id,
        group: data.group,
        vpsname: data.vpsname,
        host: data.host,
        port: data.port,
        passwd: data.passwd,
        adsl_username: data.adsl_username,
        adsl_password: data.adsl_password,
        mode: mode,
        param: param
      }
      sendJson({
        type: "run",
        data: data
      })
    }
  } else {
    let data = servers.data[ids]
    data = {
      id: data.id,
      group: data.group,
      vpsname: data.vpsname,
      host: data.host,
      port: data.port,
      passwd: data.passwd,
      adsl_username: data.adsl_username,
      adsl_password: data.adsl_password,
      mode: mode,
      param: param
    }
    updateData(ids, {
      status: "执行中",
      startTime: performance.now()
    })
    sendJson({
      type: "run",
      data: data
    })
  }
}

// 解析主机端口
function matchIPPort(host) {
  let p = /(.*):(\d*)/
  let result = host.match(p)
  if (!result || result.length != 3) return {
    ip: host,
    port: 22
  }
  return {
    ip: result[1],
    port: result[2]
  }
}

// 解析拨号账号密码
function matchADSL(adsl) {
  let p = /[(]([^ ]*)[ ]*([^ ]*)[)]/
  let result = adsl.match(p)
  if (!result || result.length != 3) return adsl
  return {
    username: result[1],
    password: result[2]
  }
}

// 筛选列
function filterCol() {
  let htmlContent = '';
  for (let i = 0; i < cols.length; i++) {
    htmlContent += `
                <div class="layui-form-item">
                    <label class="layui-form-label">` + cols[i].title + `</label>
                    <div class="layui-input-block">
                        <input type="checkbox" name="` + cols[i].field + `" lay-skin="switch" title="显示|隐藏", checked='checked'>
                    </div>
                </div>
                `;
  };
  layer.open({
    type: 1,
    resize: false,
    shadeClose: true,
    title: '显示隐藏列',
    content: `
          <form id="filterForm" class="layui-form" action="" enctype="multipart/form-data" lay-filter="filterForm">
              ` + htmlContent + `
              <div class="layui-form-item">
                  <div class="layui-input-block">
                      <button class="layui-btn" lay-submit lay-filter="subHide">确定</button>
                  </div>
              </div>
          </form>
          `,
    success: function (index) {
      let form = layui.form;
      form.render();
      let opt = {}
      for (let i = 0; i < cols.length; i++) {
        opt[cols[i].field] = !cols[i].hide
      }
      form.val('filterForm', opt);

      form.on('submit(subHide)', function (data) {
        layer.closeAll('page')
        for (let i = 0; i < cols.length; i++) {
          cols[i].hide = !(cols[i].field in data.field)
        }
        if (servers.data) {
          buildTable()
        }
        return false;
      });
    }
  });
}

// 筛选多分组
function filterGroup() {
  let htmlContent = '';
  for (group of groups) {
    htmlContent += `
                <div class="layui-form-item">
                    <label class="layui-form-label">` + group + `</label>
                    <div class="layui-input-block">
                        <input type="checkbox" name="` + group + `" lay-skin="switch" title="显示|隐藏", checked='checked'>
                    </div>
                </div>
                `;
  };
  layer.open({
    type: 1,
    resize: false,
    shadeClose: true,
    title: '产品组筛选设置',
    content: `
          <form id="filterForm" class="layui-form" action="" enctype="multipart/form-data" lay-filter="filterForm">
              ` + htmlContent + `
              <div class="layui-form-item">
                  <div class="layui-input-block">
                      <button class="layui-btn" lay-submit lay-filter="subHide">确定</button>
                  </div>
              </div>
          </form>
          `,
    success: function (index) {
      let form = layui.form;
      form.render();
      if (tableFilterParam['group']) {
        let opt = {};
        groups.forEach(function (item, index, arr) {
          opt[item] = false;
        });
        if (Array.isArray(tableFilterParam['group'])) {
          tableFilterParam['group'].forEach(function (item, index, arr) {
            opt[item] = true;
          });
        } else {
          opt[tableFilterParam['group']] = true
        }
        form.val('filterForm', opt);
      }

      form.on('submit(subHide)', function (data) {
        let filterGroups = [];
        Object.keys(data.field).forEach(function (item, index, arr) {
          filterGroups.push(item);
        });
        tableFilterParam['group'] = filterGroups
        layer.closeAll('page');
        filterDatas()
        return false;
      });
    }
  });
}

// 筛选单分组
function showGroup(group) {
  if (group) {
    tableFilterParam['group'] = group
  } else if (tableFilterParam['group']) {
    delete tableFilterParam['group']
  }
  filterDatas()
}

// 筛选状态
function showStatus(status) {
  if (status) {
    if (status == 'ok') tableFilterParam['status'] = "成功"
    else if (status == 'no') tableFilterParam['status'] = "未操作"
    else if (status == 'err') tableFilterParam['status'] = "异常"
    else if (status == 'fail') tableFilterParam['status'] = "错误"
    else if (status == 'ing') tableFilterParam['status'] = "执行中"
    else if (status == 'fe') tableFilterParam['status'] = ["错误", "异常"]
  } else if (tableFilterParam['status']) {
    delete tableFilterParam['status']
  }
  filterDatas()
}

function exportData() {
  let tr = document.querySelectorAll('tr')
  if (tr.length == 0) {
    return
  }
  let datas = Array(tr.length)
  let tl = tr[0].children.length
  for (let i = 0, l = tr.length; i < l; i++) {
    let data = Array(tl.length)
    for (let j = 0; j < tl; j++) {
      data[j] = tr[i].children[j].innerText
    }
    datas[i] = data
  }
  let head = datas.shift()
  layui.table.exportFile(head, datas, {
    type: 'xls',
    title: csvFilename + layui.util.toDateString(new Date(), "_yyyy-MM-dd_HH:mm:ss")
  });
}

// 字符串替换功能
String.prototype.replaceAll = function (s1, s2) {
  return this.replace(new RegExp(s1, "gm"), s2);
}