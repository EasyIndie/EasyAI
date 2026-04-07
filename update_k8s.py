import os
import re

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # If it's a deployment file (oneapi.yaml or batch-worker.yaml)
    if "kind: Deployment" in content and "easyai/" in content:
        # Remove the env: block and its contents
        content = re.sub(r'(\s+)env:\s*(?:\n\1  - name: .*?(?:\n\1    value(?:From)?: .*?(?:\n\1      .*?)?)*)+', r'\n\1env:\n\1  - name: ONEAPI_CONFIG_PATH\n\1    value: /app/config/oneapi.yaml', content)
        
        # Add volumeMounts and volumes if not present
        if 'volumeMounts:' not in content:
            content = re.sub(r'(\s+)(image: easyai/.*?)(?=\n\s+readinessProbe|\n\s+resources|\n\s+env:|\n\s+ports:)', r'\1\2\1volumeMounts:\1  - name: oneapi-config\1    mountPath: /app/config/oneapi.yaml\1    subPath: oneapi.yaml', content)
        
        if 'volumes:' not in content:
            content = re.sub(r'(\s+)(containers:)', r'\1volumes:\1  - name: oneapi-config\1    configMap:\1      name: oneapi-config\1\2', content)
            
    # For kustomization.yaml
    if "kind: Kustomization" in content:
        content = re.sub(r'(\s+)- ONEAPI_.*?\n', '', content)
        if 'configMapGenerator:' not in content:
            content += '\nconfigMapGenerator:\n  - name: oneapi-config\n    files:\n      - oneapi.yaml=../../../config/oneapi/oneapi.yaml\n'

    with open(filepath, 'w') as f:
        f.write(content)

for root, _, files in os.walk('k8s'):
    for file in files:
        if file.endswith('.yaml'):
            process_file(os.path.join(root, file))
