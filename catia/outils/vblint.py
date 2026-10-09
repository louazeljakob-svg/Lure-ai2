#!/usr/bin/env python3
"""Vérificateur statique approximatif pour CATScript / VBScript.

Contrôles :
  - équilibre des blocs (Sub/Function/If/For/Do/Select/With/While) ;
  - variables utilisées mais non déclarées (Dim, Const, paramètres) ;
  - appels de procédures utilisateur : existence et nombre d'arguments ;
  - appel de Sub avec parenthèses et plusieurs arguments (erreur VBScript) ;
  - fonctions VBA absentes de VBScript (IIf, Format, ...).
"""
import re
import sys

KEYWORDS = set(w.lower() for w in """
Dim ReDim Preserve Const Sub Function End Exit If Then Else ElseIf For To Step Next
Each In Do Loop While Until Wend Select Case With Set Call On Error Resume GoTo And Or
Not Xor Is Mod New ByVal ByRef Private Public Option Explicit Eqv Imp Let Get Property
As Optional WithEvents Me Integer Long String Double Single Boolean Variant Object Byte Currency
Unload Load MSForms Collection
""".split())

BUILTINS = set(w.lower() for w in """
Abs Array Asc Atn CBool CByte CCur CDate CDbl Chr CInt CLng Cos CreateObject CSng CStr
Date DateAdd Day Exp Fix Hex Hour InStr InStrRev Int IsArray IsDate IsEmpty IsNull
IsNumeric IsObject Join LBound LCase Left Len Log LTrim Mid Minute Month MsgBox InputBox
Now Oct Replace Right Rnd Round RTrim Second Sgn Sin Space Split Sqr String Tan Time
Timer Trim TypeName UBound UCase Year Err CATIA Empty Nothing Null True False
""".split())

VBA_BUILTINS = set(w.lower() for w in """
IIf Format Environ DoEvents CallByName vbCrLf vbLf vbCr vbNewLine vbTab vbYesNo vbYes vbNo
vbOKOnly vbOKCancel vbQuestion vbInformation vbExclamation vbCritical vbYesNoCancel vbCancel
vbModeless vbModal
""".split())

NOT_IN_VBSCRIPT = {"iif", "format", "format$", "environ", "environ$", "doevents", "callbyname"}

ENUM_PREFIXES = ("catcst", "catmeasurable", "catworkmode")
ENUM_NAMES = {"design_mode", "visualization_mode", "default_mode"}

SIG = re.compile(r"(?:(?:Public|Private)\s+)?(Sub|Function)\s+(\w+)\s*(?:\((.*?)\))?\s*(?:As\s+[\w\.]+)?\s*$", re.I)


def strip_line(line):
    """Retire commentaire et remplace les chaînes par des marqueurs."""
    out = []
    strings = []
    i = 0
    n = len(line)
    while i < n:
        c = line[i]
        if c == '"':
            j = i + 1
            buf = []
            while j < n:
                if line[j] == '"':
                    if j + 1 < n and line[j + 1] == '"':
                        buf.append('"')
                        j += 2
                        continue
                    break
                buf.append(line[j])
                j += 1
            if j >= n:
                raise ValueError("chaîne non fermée")
            strings.append("".join(buf))
            out.append('""')
            i = j + 1
            continue
        if c == "'":
            break
        out.append(c)
        i += 1
    code = "".join(out)
    if re.match(r"\s*rem\s", code, re.I):
        code = ""
    return code, strings


def logical_lines(text):
    """Renvoie (n° de ligne, code) en joignant les continuations " _"."""
    res = []
    buf = ""
    start = None
    for no, raw in enumerate(text.splitlines(), 1):
        code, _ = strip_line(raw)
        if start is None:
            start = no
        if re.search(r"\s_\s*$", code):
            buf += re.sub(r"\s_\s*$", " ", code)
            continue
        buf += code
        res.append((start, buf))
        buf = ""
        start = None
    return res


def split_statements(code):
    parts = []
    depth = 0
    cur = ""
    for ch in code:
        if ch == ":" and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


def split_args(s):
    """Découpe une liste d'arguments au niveau 0 des parenthèses."""
    args = []
    depth = 0
    cur = ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            args.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        args.append(cur)
    return [a.strip() for a in args]


def match_paren(s, i):
    depth = 0
    for j in range(i, len(s)):
        if s[j] == "(":
            depth += 1
        elif s[j] == ")":
            depth -= 1
            if depth == 0:
                return j
    return -1


def declared_names(decl):
    names = []
    for part in split_args(decl):
        m = re.match(r"([A-Za-z_]\w*)", part)
        if m:
            names.append(m.group(1).lower())
    return names


def lire(path):
    data = open(path, "rb").read()
    try:
        raw = data.decode("utf-8")
    except UnicodeDecodeError:
        raw = data.decode("cp1252")
    # .frm / .bas / .cls : on saute l'en-tête (VERSION, Begin ... End, Attribute)
    if path.lower().endswith((".frm", ".bas", ".cls")):
        out = []
        entete = path.lower().endswith(".frm")
        for l in raw.splitlines():
            if entete:
                if l.startswith("Attribute VB_Name"):
                    entete = False
                out.append("")
                continue
            out.append("" if l.startswith("Attribute VB_") else l)
        raw = "\n".join(out)
    return raw


def main(path, projet=None):
    raw = lire(path)
    vba = path.lower().endswith((".frm", ".bas", ".cls"))
    lines = logical_lines(raw)
    errors = []

    # 1er passage : procédures, globales (+ procédures publiques des autres fichiers)
    procs = dict(projet or {})
    module_vars = set(PROJET_VARS)
    in_proc = None
    for no, code in lines:
        for st in split_statements(code):
            m = SIG.match(st)
            if m:
                params = [p for p in split_args(m.group(3) or "")]
                noms = []
                nreq = 0
                for prm in params:
                    opt = re.match(r"\s*Optional\b", prm, re.I) is not None
                    prm2 = re.sub(r"^\s*(Optional\s+)?(ByVal\s+|ByRef\s+)?", "", prm, flags=re.I)
                    noms.append(re.match(r"(\w+)", prm2).group(1).lower())
                    if not opt:
                        nreq += 1
                procs[m.group(2).lower()] = (m.group(1).lower(), noms, no, nreq)
                in_proc = m.group(2).lower()
                continue
            if re.match(r"End\s+(Sub|Function)\b", st, re.I):
                in_proc = None
                continue
            if in_proc is None:
                m = re.match(r"(Dim|Const|Public|Private)\s+(?:(Const|WithEvents)\s+)?(.*)$", st, re.I)
                if m:
                    body = m.group(3)
                    if m.group(1).lower() == "const" or (m.group(2) or "").lower() == "const":
                        module_vars.add(re.match(r"(\w+)", body).group(1).lower())
                    else:
                        module_vars.update(declared_names(body))

    # 2e passage : blocs, déclarations locales, usages
    stack = []
    cur = None
    local = set()
    for no, code in lines:
        for st in split_statements(code):
            low = st.lower()
            m = re.match(r"(?:(?:public|private)\s+)?(sub|function)\s+(\w+)", low)
            if m and not low.startswith(("private const", "public const")):
                if stack:
                    errors.append(f"{no}: procédure ouverte dans un bloc {stack}")
                stack = [(m.group(1), no)]
                cur = m.group(2)
                if len(set(procs[cur][1])) != len(procs[cur][1]):
                    errors.append(f"{no}: paramètres en double dans {cur}")
                local = set(procs[cur][1]) | {cur}
                continue
            m = re.match(r"end\s+(sub|function|if|select|with)\b", low)
            if m:
                kind = m.group(1)
                if not stack or stack[-1][0] != kind:
                    errors.append(f"{no}: 'End {kind}' inattendu (pile {stack[-3:]})")
                else:
                    stack.pop()
                if kind in ("sub", "function"):
                    if stack:
                        errors.append(f"{no}: blocs non fermés en fin de procédure : {stack}")
                    stack = []
                    cur = None
                continue
            if re.match(r"exit\s+(sub|function|for|do)\b", low):
                continue
            # Blocs
            mif = re.match(r"(if|elseif)\b(.*)\bthen\b(.*)$", low)
            if mif:
                after = mif.group(3).strip()
                if mif.group(1) == "if" and after == "":
                    stack.append(("if", no))
                elif mif.group(1) == "elseif" and (not stack or stack[-1][0] != "if"):
                    errors.append(f"{no}: ElseIf hors bloc If")
                body_for_usage = mif.group(2) + " " + after
            elif re.match(r"else\b", low):
                if not stack or stack[-1][0] != "if":
                    errors.append(f"{no}: Else hors bloc If")
                body_for_usage = low[4:]
            elif re.match(r"for\b", low):
                stack.append(("for", no))
                body_for_usage = re.sub(r"^for\s+each\b", "", low)
                body_for_usage = re.sub(r"^for\b", "", body_for_usage)
            elif re.match(r"next\b", low):
                if not stack or stack[-1][0] != "for":
                    errors.append(f"{no}: Next sans For (pile {stack[-3:]})")
                else:
                    stack.pop()
                body_for_usage = ""
            elif re.match(r"do\b", low):
                stack.append(("do", no))
                body_for_usage = low[2:]
            elif re.match(r"loop\b", low):
                if not stack or stack[-1][0] != "do":
                    errors.append(f"{no}: Loop sans Do")
                else:
                    stack.pop()
                body_for_usage = low[4:]
            elif re.match(r"select\s+case\b", low):
                stack.append(("select", no))
                body_for_usage = low[11:]
            elif re.match(r"case\b", low):
                if not stack or stack[-1][0] != "select":
                    errors.append(f"{no}: Case hors Select")
                body_for_usage = "" if re.match(r"case\s+else\b", low) else low[4:]
            elif re.match(r"with\b", low):
                stack.append(("with", no))
                body_for_usage = low[4:]
            elif re.match(r"while\b", low):
                stack.append(("while", no))
                body_for_usage = low[5:]
            elif re.match(r"wend\b", low):
                if not stack or stack[-1][0] != "while":
                    errors.append(f"{no}: Wend sans While")
                else:
                    stack.pop()
                body_for_usage = ""
            else:
                body_for_usage = low

            # Déclarations locales
            md = re.match(r"(dim|redim(?:\s+preserve)?|const)\s+(.*)$", low)
            if md:
                if cur is None:
                    continue
                if md.group(1) == "const":
                    local.add(re.match(r"(\w+)", md.group(2)).group(1))
                    body_for_usage = md.group(2).split("=", 1)[1]
                elif md.group(1) == "dim":
                    for nm in declared_names(md.group(2)):
                        if nm in local:
                            errors.append(f"{no}: déclaration en double '{nm}' dans {cur} (VBA ne distingue pas les majuscules)")
                        local.add(nm)
                    # tailles de tableaux éventuelles
                    body_for_usage = " ".join(re.findall(r"\(([^)]*)\)", md.group(2)))
                else:
                    body_for_usage = md.group(2)
            if cur is None and body_for_usage.strip():
                if not re.match(r"(dim|const|public|private|option)\b", low):
                    errors.append(f"{no}: instruction hors procédure : {st}")
                continue

            # Usages d'identifiants
            text = re.sub(r'""', " ", body_for_usage)
            text = re.sub(r"&h[0-9a-f]+&?", " ", text)
            text = re.sub(r"\b\d+(\.\d+)?(e[+-]?\d+)?\b", " ", text)
            for mm in re.finditer(r"(\.)?\s*\b([a-z_]\w*)\b", text):
                if mm.group(1):
                    continue
                name = mm.group(2)
                if name in KEYWORDS or name in BUILTINS:
                    continue
                if vba and (name in VBA_BUILTINS or name.startswith(("fm", "vb"))):
                    continue
                if name in NOT_IN_VBSCRIPT and not vba:
                    errors.append(f"{no}: fonction absente de VBScript : {name}")
                    continue
                if name.startswith(ENUM_PREFIXES) or name in ENUM_NAMES:
                    continue
                if name in local or name in module_vars or name in procs:
                    continue
                errors.append(f"{no}: identifiant non déclaré '{name}' dans {cur}")

            # Appels de procédures utilisateur
            # a) instruction : NomSub args   ou   NomSub(a, b)  (interdit)
            ms = re.match(r"(?:call\s+)?([a-z_]\w*)\b(.*)$", low)
            if ms and ms.group(1) in procs and not re.match(r"\s*=", ms.group(2)) and not re.match(r"\s*\(.*\)\s*=", ms.group(2)):
                name = ms.group(1)
                rest = ms.group(2).strip()
                is_call_kw = low.startswith("call ")
                if rest.startswith("(") and match_paren(rest, 0) == len(rest) - 1:
                    args = split_args(rest[1:-1])
                    if len(args) > 1 and not is_call_kw:
                        errors.append(f"{no}: appel de {name} avec parenthèses et plusieurs arguments")
                else:
                    args = split_args(rest) if rest else []
                exp = len(procs[name][1])
                nreq = procs[name][3]
                if not (nreq <= len(args) <= exp):
                    errors.append(f"{no}: {name} appelé avec {len(args)} argument(s), {nreq} à {exp} attendu(s)")
            # b) appels dans les expressions : Nom(...)
            for mm in re.finditer(r"(?<![\.\w])([a-z_]\w*)\s*\(", low):
                name = mm.group(1)
                if name in procs and procs[name][0] == "function":
                    j = match_paren(low, mm.end() - 1)
                    if j < 0:
                        errors.append(f"{no}: parenthèse non fermée après {name}")
                        continue
                    if ms and ms.group(1) == name and mm.start() == low.find(name):
                        # déjà traité comme instruction (ou affectation de la valeur de retour)
                        if re.match(r"\s*=", low[len(name):]):
                            continue
                        if low.startswith(name):
                            continue
                    args = split_args(low[mm.end():j])
                    exp = len(procs[name][1])
                    nreq = procs[name][3]
                    if not (nreq <= len(args) <= exp):
                        errors.append(f"{no}: {name}() appelé avec {len(args)} argument(s), {nreq} à {exp} attendu(s)")
                elif name in procs and procs[name][0] == "sub":
                    if not low.startswith(name):
                        errors.append(f"{no}: Sub {name} utilisée dans une expression")

    if stack:
        errors.append(f"fin de fichier : blocs non fermés {stack}")

    # Procédures définies mais jamais appelées (information)
    used = set()
    for no, code in lines:
        for mm in re.finditer(r"\b([A-Za-z_]\w*)\b", code):
            used.add(mm.group(1).lower())
    body_counts = {}
    for name in procs:
        cnt = len(re.findall(r"\b" + re.escape(name) + r"\b", raw, re.I))
        body_counts[name] = cnt

    print(f"{path}: {len(procs)} procédures, {len(module_vars)} globales")
    for name, (kind, params, no, _) in sorted(procs.items(), key=lambda x: x[1][2]):
        if name in (projet or {}):
            continue
        if name != "catmain" and "_" not in name and body_counts[name] <= 1:
            print(f"  info : {kind} {name} (ligne {no}) jamais appelée")
    if errors:
        print(f"{len(errors)} problème(s) :")
        for e in errors:
            print("  " + e)
        return 1
    print("aucun problème détecté")
    return 0


PROJET_VARS = set()


def publics(path):
    """Procédures et variables publiques d'un module (pour un projet VBA)."""
    procs, vars_ = {}, set()
    in_proc = False
    for no, code in logical_lines(lire(path)):
        for st in split_statements(code):
            m = SIG.match(st)
            if m:
                in_proc = True
                if not st.lower().startswith("private"):
                    params = split_args(m.group(3) or "")
                    noms, nreq = [], 0
                    for prm in params:
                        opt = re.match(r"\s*Optional\b", prm, re.I) is not None
                        prm2 = re.sub(r"^\s*(Optional\s+)?(ByVal\s+|ByRef\s+)?", "", prm, flags=re.I)
                        noms.append(re.match(r"(\w+)", prm2).group(1).lower())
                        nreq += 0 if opt else 1
                    procs[m.group(2).lower()] = (m.group(1).lower(), noms, no, nreq)
                continue
            if re.match(r"End\s+(Sub|Function)\b", st, re.I):
                in_proc = False
                continue
            if not in_proc:
                mm = re.match(r"Public\s+(?:(Const|WithEvents)\s+)?(.*)$", st, re.I)
                if mm:
                    if (mm.group(1) or "").lower() == "const":
                        vars_.add(re.match(r"(\w+)", mm.group(2)).group(1).lower())
                    else:
                        vars_.update(declared_names(mm.group(2)))
    return procs, vars_


if __name__ == "__main__":
    # Usage : vblint.py fichier...   (les .bas/.frm d'un même appel forment un projet VBA)
    rc = 0
    fichiers = sys.argv[1:]
    projet = {}
    for p in fichiers:
        if p.lower().endswith(".bas"):
            pr, va = publics(p)
            projet.update(pr)
            PROJET_VARS.update(va)
        if p.lower().endswith((".frm", ".cls", ".bas")):
            m = re.search(r'Attribute VB_Name = "(\w+)"', open(p, "rb").read().decode("cp1252", "replace"))
            if m:
                PROJET_VARS.add(m.group(1).lower())
    for p in fichiers:
        autres = {k: v for k, v in projet.items()} if not p.lower().endswith(".bas") else None
        rc |= main(p, autres)
    sys.exit(rc)
