"""Tiny builder for FigCraft `run` scripts: tracks layer ids so children can name their parent.
FigCraft numbers new layers 2, 3, 4… in creation order (checked against the run output)."""
import json


class Doc:
    def __init__(self):
        self.cmds = []
        self.next_id = 2

    def _new(self, cmd, params):
        self.cmds.append({"command": cmd, "params": params})
        i = self.next_id
        self.next_id += 1
        return i

    def frame(self, parent=None, name=None, w=None, h=None, x=0, y=0, index=None, **props):
        p = {"type": "frame", "x": x, "y": y, "props": props, "select": False}
        if index is not None: p["index"] = index
        if w is not None: p["width"] = w
        if h is not None: p["height"] = h
        if parent is not None: p["parent"] = parent
        if name: p["name"] = name
        props.setdefault("fills", [])
        return self._new("node.create", p)

    def box(self, parent, name=None, **props):
        """Auto-layout frame that hugs its content unless told otherwise."""
        props.setdefault("sizingH", "hug")
        props.setdefault("sizingV", "hug")
        return self.frame(parent, name, **props)

    def text(self, parent, s, size=14, weight="Regular", color="#0F1F1B", family="Inter", **props):
        props.update({"fontSize": size, "fontFamily": family, "fontStyle": weight, "fill": color})
        p = {"type": "text", "text": s, "x": 0, "y": 0, "parent": parent, "props": props, "select": False}
        return self._new("node.create", p)

    def rect(self, parent, w, h, **props):
        p = {"type": "rectangle", "x": 0, "y": 0, "width": w, "height": h, "parent": parent, "props": props, "select": False}
        return self._new("node.create", p)

    def ellipse(self, parent, w, h, **props):
        p = {"type": "ellipse", "x": 0, "y": 0, "width": w, "height": h, "parent": parent, "props": props, "select": False}
        return self._new("node.create", p)

    def vector(self, parent, path, w, h, **props):
        p = {"type": "vector", "x": 0, "y": 0, "width": w, "height": h, "parent": parent, "path": path, "props": props, "select": False}
        return self._new("node.create", p)

    def raw(self, command, params, creates=False):
        if creates:
            return self._new(command, params)
        self.cmds.append({"command": command, "params": params})

    def save(self, path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.cmds, f)
