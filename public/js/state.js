window.State = {
  rawMessages: [],      // flat array of message-level objects from the server
  groupedNodes: [],     // compressed timeline groups (output of two-pass algorithm)
  selectedNodeId: null,
  comments: {},
  fileChanges: {},
  sessionMeta: {},
  modalNodeId: null,
  uploadedPath: null,
};
